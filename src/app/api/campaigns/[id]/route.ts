export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  getCampaign,
  softDeleteCampaign,
  updateCampaign,
} from "@/lib/db/queries/campaigns";
import { removeBunnyAssetRefsForOwner } from "@/lib/db/queries/bunny-assets";
import { triggerBunnyPurgeTick } from "@/lib/bunny/purge-trigger";
import type { CampaignThumbnailImage } from "@/lib/segments/types";
import { ensureIntroCalibration } from "@/lib/intro-calibration-enqueue";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  mode: z.enum(["webcam-only", "with-presentation"]).optional(),
  webcamMediaId: z.string().uuid().nullable().optional(),
  segments: z.array(z.unknown()).optional(),
  pipPosition: z.enum(["bottom-left", "bottom-right"]).optional(),
  pipShape: z.enum(["square", "rounded", "circle"]).optional(),
  landingPageTemplateId: z.string().uuid().nullable().optional(),
  customLpTemplateId: z.string().uuid().nullable().optional(),
  domainId: z.string().uuid().nullable().optional(),
  slugTemplate: z.string().min(1).max(120).nullable().optional(),
  /**
   * Optionaler Tenant-Suffix für Lead-Slugs (Migration 0014).
   * `null` → SQL NULL setzen, `undefined` → Feld nicht ändern (Zod-`.optional()`
   * lässt den Key dann weg, der Drizzle-UPDATE faesst ihn nicht an).
   * Format-Regex spiegelt die DB-CHECK-Constraint `campaigns_slug_suffix_check`.
   */
  slugSuffix: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/, "Nur a-z, 0-9 und Bindestrich, max. 32 Zeichen.")
    .nullable()
    .optional(),
  pdfEnabled: z.boolean().optional(),
  pdfGoogleDocsUrl: z.string().url().nullable().optional(),
  // ── A/B-Test (Migration 0034) ─────────────────────────────────────────
  // Aktivieren = abTestingEnabled:true + pdfGoogleDocsUrlB setzen.
  // Gewinner B übernehmen = pdfGoogleDocsUrl:<urlB> + abTestingEnabled:false.
  // Laufende Runden bleiben unberührt (Snapshot in runs.ab_config).
  abTestingEnabled: z.boolean().optional(),
  pdfGoogleDocsUrlB: z.string().url().nullable().optional(),
  // Standard-Verteilung (Migration 0035) — vorbefüllt den Runden-Wizard.
  abSplitMode: z.enum(["random", "sequential"]).optional(),
  abSplitWeightA: z.number().int().min(10).max(90).optional(),
  pdfQrEnabled: z.boolean().optional(),
  pdfThumbnailEnabled: z.boolean().optional(),
  pdfThumbnailFrameMs: z.number().int().nonnegative().nullable().optional(),
  // ── Thumbnail-Generator (Migration 0018 + 0019) ─────────────────────────
  // Spiegel zur POST-Validierung. `thumbnailImage` als `unknown` (Editor
  // garantiert Form). `thumbnailMode` ist die Single-Source-of-Truth für
  // die drei Vorschaubild-Varianten; `thumbnailImageEnabled` bleibt als
  // computed mirror in der API (Frontend hält beides synchron) bis der
  // Pipeline-Code in Paket B/C konsequent auf `thumbnailMode` umzieht.
  thumbnailImageEnabled: z.boolean().optional(),
  thumbnailImage: z.unknown().nullable().optional(),
  thumbnailMode: z
    .enum(["frame", "custom_image", "landingpage_screenshot"])
    .optional(),
  thumbnailPlayIcon: z.boolean().optional(),
  // ── Personalisierte Video-Begrüßung (Migration 0042) ────────────────────
  // Aktivierung setzt UI-seitig ein ready-Voice-Profil + Kalibrierung
  // voraus; die Pipeline fällt sonst automatisch aufs Original zurück.
  introEnabled: z.boolean().optional(),
  // ── Kampagnen-Entwürfe (Migration 0052) ─────────────────────────────────
  // Nur die Aktivierung ist erlaubt (draft → active); der umgekehrte Weg
  // existiert bewusst nicht — eine live geschaltete Kampagne kann Runden
  // haben und darf nicht zurück in den Wizard-Limbus. `wizardState` ist
  // der Auto-Save-Snapshot des Wizards; bei Aktivierung wird er genullt.
  status: z.literal("active").optional(),
  wizardState: z.unknown().nullable().optional(),
  // TTS-Vorlage für den Kalibrierungs-Anstoß bei der Aktivierung —
  // gleiche Regeln wie im POST-Endpoint.
  introTtsTemplate: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => v.includes("{vorname}") || v.includes("{nachname}"), {
      message: "Vorlage muss {vorname} oder {nachname} enthalten.",
    })
    .optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const campaign = await getCampaign(params.id, auth.user.id);
    return NextResponse.json({ campaign });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  // `thumbnailImage` ist als `unknown` validiert — die Drizzle-UPDATE-
  // Types wollen `CampaignThumbnailImage | null | undefined`. Wir cast'en
  // nur, wenn der Key tatsächlich gesetzt war, damit Drizzle's „nur
  // gesetzte Spalten anfassen"-Semantik erhalten bleibt.
  const { thumbnailImage, introTtsTemplate, ...rest } = body;
  const activating = rest.status === "active";
  const patch = {
    ...rest,
    // Bei Aktivierung den Wizard-Snapshot immer entsorgen — die echten
    // Spalten sind ab jetzt die Wahrheit.
    ...(activating ? { wizardState: null } : {}),
    ...(thumbnailImage === undefined
      ? {}
      : { thumbnailImage: thumbnailImage as CampaignThumbnailImage | null }),
  };
  try {
    const campaign = await updateCampaign(params.id, auth.user.id, patch);
    // Kalibrierung für die KI-Begrüßung anstoßen, sobald der Entwurf
    // fertiggestellt wird (Spiegel zur POST-Logik bei Direkt-Erstellung).
    if (activating && campaign.introEnabled && campaign.webcamMediaId) {
      await ensureIntroCalibration(
        auth.user.id,
        campaign.webcamMediaId,
        introTtsTemplate,
      );
    }
    return NextResponse.json({ campaign });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * DELETE /api/campaigns/[id] — Soft-Delete + Bunny-Cleanup-Cascade.
 *
 * 1. `softDeleteCampaign` setzt `deletedAt`. Listen-Queries blenden den
 *    Eintrag damit sofort aus.
 * 2. Vor dem Soft-Delete-Marker holen wir Lead-/Run-IDs der Kampagne, weil
 *    `deletedAt` keine FK-Cascade auslöst. Ohne diesen Snapshot würden die
 *    Bunny-Refs für immer überleben und der Purge-Worker fände sie nie.
 * 3. Alle `bunny_asset_refs` der Owner (leads / runs / campaign_webcam)
 *    werden entfernt. Der nächste `markOrphanedAssetsForPurge`-Tick (Cron
 *    alle 60s oder unser direkter Trigger unten) markiert Assets ohne Refs
 *    als `purge_pending`; der Purge-Worker löscht sie dann aus Bunny.
 * 4. Trigger sofort einen Purge-Tick, damit Bunny-Cleanup nicht bis zur
 *    nächsten Cron-Minute wartet. Trigger ist fire-and-forget; der 60s-Cron
 *    fängt Fehler ab.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Snapshot der Lead-/Run-IDs VOR dem Soft-Delete-Marker. Wir scopen
  // strikt auf den User, weil `removeBunnyAssetRefsForOwner` keinen
  // Tenant-Check macht — damit kann ein anderer Tenant nie Refs eines
  // Fremd-Owners abrauben.
  let leadIds: string[];
  let runIds: string[];
  try {
    // Ownership-Check als Seiteneffekt: wirft "Not found" wenn Kampagne
    // einem anderen User gehört oder bereits soft-deleted ist.
    await getCampaign(params.id, auth.user.id);
    const runRows = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.campaignId, params.id), eq(runs.userId, auth.user.id)));
    runIds = runRows.map((r) => r.id);
    // Leads haben kein `userId` direkt — wir scopen über den Join auf
    // `runs.userId`, damit ein anderer Tenant nie Refs eines Fremd-Leads
    // abrauben kann (Tenant-Guard).
    const leadRows = await db
      .select({ id: leads.id })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(
        and(eq(leads.campaignId, params.id), eq(runs.userId, auth.user.id)),
      );
    leadIds = leadRows.map((l) => l.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  try {
    await softDeleteCampaign(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Refs entfernen. Wir nutzen `Promise.all`, damit eine grosse Kampagne
  // mit vielen Leads nicht sequenziell durch hunderte DB-Roundtrips
  // läuft. Bei einem einzelnen Fehler swallowt der catch — der Purge-
  // Worker findet die Asset später trotzdem nicht mehr, wenn die Refs
  // weg sind, und der Cron räumt Orphan-Refs nach.
  try {
    await Promise.all([
      ...leadIds.map((id) => removeBunnyAssetRefsForOwner("lead", id)),
      ...runIds.map((id) => removeBunnyAssetRefsForOwner("run", id)),
      removeBunnyAssetRefsForOwner("campaign_webcam", params.id),
    ]);
  } catch (err) {
    // Soft-Delete ist bereits durch — UI sieht Cleanup, der Worker-Cron
    // räumt verbleibende Refs nach. Daher nur loggen, nicht failen.
    // eslint-disable-next-line no-console
    console.warn("[campaigns:delete] ref cleanup partial failure:", err);
  }

  // Sofortige Purge anstossen (fire-and-forget). Cron alle 60s ist der
  // Fallback, falls der Trigger fehlschlägt.
  void triggerBunnyPurgeTick("campaigns:delete");

  return NextResponse.json({ ok: true });
}
