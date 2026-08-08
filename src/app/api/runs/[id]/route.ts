export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  deleteRun,
  getRun,
  updateRun,
} from "@/lib/db/queries/runs";
import { countByStatus } from "@/lib/db/queries/leads";
import { removeBunnyAssetRefsForOwner } from "@/lib/db/queries/bunny-assets";
import { triggerBunnyPurgeTick } from "@/lib/bunny/purge-trigger";
import { getRunEta } from "@/lib/run-eta-read";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z
    .enum(["draft", "mapping", "generating", "completed", "failed", "cancelled"])
    .optional(),
  /** Umschlag-Vorlage fuer diese Runde (null = keine Umschlaege). */
  envelopeTemplateId: z.string().uuid().nullable().optional(),
});

/**
 * GET /api/runs/[id] — returns the run + per-status lead counts + server ETA
 * (W3, Redis-Cache; nur bei laufender Generierung, sonst null).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const run = await getRun(params.id, auth.user.id);
    const counts = await countByStatus(params.id, auth.user.id);
    const eta = run.status === "generating" ? await getRunEta(run.id) : null;
    return NextResponse.json({ run, counts, eta });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * PATCH /api/runs/[id] — update name or transition status (e.g. cancel).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  try {
    const run = await updateRun(params.id, auth.user.id, body);
    return NextResponse.json({ run });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * DELETE /api/runs/[id] — HARD-Delete + Bunny-Cleanup-Cascade.
 *
 * Migration 0023:
 *   Bis hierhin war das ein Soft-Delete (nur `runs.deleted_at` gesetzt).
 *   Folge war ein Slug-Leak: die Leads des „gelöschten" Runs blieben
 *   physisch in der Tabelle, ihre `slug`-Werte zählten weiter im
 *   campaign-scoped Slug-Uniqueness-Check (`findSlugInCampaign`), und
 *   ein Folge-Run derselben Kampagne bekam `-2`, `-3`, … Suffixe an die
 *   neuen Lead-Slugs. Wir löschen jetzt hart.
 *
 * Reihenfolge ist wichtig — die FK-Cascade räumt Leads/Events erst NACH
 * dem `delete(runs)` auf:
 *
 *   1. Ownership prüfen (`getRun`) + Lead-IDs snapshot'en. Letzteres
 *      brauchen wir BEVOR der Hard-Delete die Lead-Rows wegräumt.
 *   2. `bunny_asset_refs` für jeden Lead-Owner und den Run-Owner
 *      entfernen. Muss VOR dem Hard-Delete passieren, weil die Refs
 *      über (owner_type, owner_id) referenzieren — gibt es den Lead
 *      nicht mehr, wären die Refs danach „verwaiste Ref-Rows" und
 *      würden den Asset trotzdem am Leben halten, bis der Sweeper sie
 *      einsammelt.
 *      Refs für Assets, die NOCH von anderen Runs/Leads verwendet
 *      werden (z.B. Shared-Webcam zwischen Runs), bleiben am Asset
 *      hängen und schützen die GUID vor dem Purge.
 *   3. `db.delete(runs)` — die FK-Cascade nuked dann `leads`,
 *      `lead_events`, `pipeline_events`, `analytics_events` in einem
 *      Rutsch (Migration 0023 stellt die ON DELETE CASCADE produktiv
 *      defensiv sicher). Damit sind die Lead-Slugs frei.
 *   4. Bunny-Purge-Tick triggern; Cron alle 60s ist Fallback.
 *
 * Bunny-Assets selbst werden NICHT hart gelöscht: der zentrale Purge-
 * Worker erkennt orphane Assets (`NOT EXISTS (SELECT 1 FROM
 * bunny_asset_refs …)`) und stellt damit sicher, dass ein zwischen
 * Runs geteiltes Video (z.B. webcam-only Shared-Webcam, Campaign-
 * Webcam-Media oder ein neuer Run mit derselben GUID) NICHT versehentlich
 * weggeworfen wird. Per-Lead-gerenderte Videos verlieren mit dem letzten
 * Ref ihre Existenzberechtigung und werden vom Worker entfernt.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let leadIds: string[];
  try {
    // Verify ownership first.
    await getRun(params.id, auth.user.id);
    // Snapshot Lead-IDs scoped auf den Run und (via Join) auf den User.
    // Muss VOR dem Hard-Delete passieren — der Cascade räumt sonst die
    // Lead-Rows weg, bevor wir ihre IDs für die Bunny-Ref-Cleanup haben.
    const leadRows = await db
      .select({ id: leads.id })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(and(eq(leads.runId, params.id), eq(runs.userId, auth.user.id)));
    leadIds = leadRows.map((l) => l.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  try {
    // 1. Bunny-Asset-Refs für Leads + Run abräumen (vor dem Cascade!).
    //    Polymorpher Owner_id → keine echte FK, der Cascade greift hier
    //    nicht. Ohne dieses Cleanup würden die Refs dangle'en und den
    //    Purge-Worker am Erkennen orphaner Assets hindern.
    await Promise.all([
      ...leadIds.map((id) => removeBunnyAssetRefsForOwner("lead", id)),
      // `run`-Owner deckt sharedBunnyVideoId der Webcam-only-Optimierung
      // ab. Refs für das Shared-Webcam-Video, das NUR dieser Run nutzte,
      // werden hier entfernt; teilen sich mehrere Runs dieselbe GUID,
      // bleibt der Asset über die Refs der anderen Runs geschützt.
      removeBunnyAssetRefsForOwner("run", params.id),
    ]);
  } catch (err) {
    // Soft-Fail: Cleanup darf den eigentlichen Run-Delete nicht blockieren.
    // Übriggebliebene Refs holt der Sweeper im nächsten Cron-Tick auf.
    // eslint-disable-next-line no-console
    console.warn("[runs:delete] ref cleanup partial failure:", err);
  }

  try {
    // 2. HARD-Delete. FK ON DELETE CASCADE räumt leads + lead_events +
    //    analytics_events + pipeline_events automatisch ab. Lead-Slugs
    //    sind danach wieder frei.
    await deleteRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  void triggerBunnyPurgeTick("runs:delete");

  return NextResponse.json({ ok: true });
}
