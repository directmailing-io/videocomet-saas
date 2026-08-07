export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createCampaign,
  listUserCampaigns,
} from "@/lib/db/queries/campaigns";
import type { CampaignThumbnailImage } from "@/lib/segments/types";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { introCalibrations } from "@/lib/db/schema";
import { introCalibrationQueue } from "@/worker/intro-queue";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  mode: z.enum(["webcam-only", "with-presentation"]).default("webcam-only"),
  webcamMediaId: z.string().uuid().nullable().optional(),
  segments: z.array(z.unknown()).optional(),
  pipPosition: z.enum(["bottom-left", "bottom-right"]).optional(),
  pipShape: z.enum(["square", "rounded", "circle"]).optional(),
  landingPageTemplateId: z.string().uuid().nullable().optional(),
  customLpTemplateId: z.string().uuid().nullable().optional(),
  domainId: z.string().uuid().nullable().optional(),
  slugTemplate: z.string().min(1).max(120).nullable().optional(),
  /**
   * Optionaler Tenant-Suffix für Lead-Slugs (Migration 0014). Format identisch
   * zur DB-CHECK-Constraint: lowercase alphanumerisch + Bindestrich, 1-32 Zeichen.
   * `null` → SQL NULL setzen, `undefined` → Feld nicht ändern.
   */
  slugSuffix: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/, "Nur a-z, 0-9 und Bindestrich, max. 32 Zeichen.")
    .nullable()
    .optional(),
  pdfEnabled: z.boolean().optional(),
  pdfGoogleDocsUrl: z.string().url().nullable().optional(),
  // A/B-Test direkt bei der Erstellung: Brief B + Aktivierung. Die
  // Aktiv-Semantik (nur wirksam wenn pdfEnabled + beide URLs) prüft der
  // Start-Endpoint erneut — hier reicht Format-Validierung.
  abTestingEnabled: z.boolean().optional(),
  pdfGoogleDocsUrlB: z.string().url().nullable().optional(),
  abSplitMode: z.enum(["random", "sequential"]).optional(),
  abSplitWeightA: z.number().int().min(10).max(90).optional(),
  pdfQrEnabled: z.boolean().optional(),
  pdfThumbnailEnabled: z.boolean().optional(),
  pdfThumbnailFrameMs: z.number().int().nonnegative().nullable().optional(),
  // ── Thumbnail-Generator (Migration 0018 + 0019) ─────────────────────────
  // `thumbnailImage` ist die Slide-Konfiguration für den Modus
  // 'custom_image'. Bei den anderen Modi wird das Feld ignoriert. Wir
  // erlauben `unknown`, weil das vollständige Schema des Folien-Editors
  // hier kein Validation-Wert bringt — der Renderer prüft Form selbst.
  thumbnailImageEnabled: z.boolean().optional(),
  thumbnailImage: z.unknown().nullable().optional(),
  thumbnailMode: z
    .enum(["frame", "custom_image", "landingpage_screenshot"])
    .optional(),
  thumbnailPlayIcon: z.boolean().optional(),
  introEnabled: z.boolean().optional(),
  /**
   * Optionales TTS-Template beim Kalibrierungs-Initial-Insert. Wird nur
   * angenommen, wenn intro_enabled und noch keine Kalibrierung existiert;
   * ansonsten bleibt die bestehende Template-Wahl unverändert. Muss den
   * gleichen Format-Regeln entsprechen wie im PATCH-Endpoint.
   */
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

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const campaigns = await listUserCampaigns(auth.user.id);
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  // `thumbnailImage` ist als `unknown` validiert — der Drizzle-Insert-
  // Type erwartet `CampaignThumbnailImage | null | undefined`. Wir cast'en
  // hier bewusst, weil die Folien-Struktur vom Editor garantiert wird;
  // ein invaliderer Renderer-Pfad fängt Schema-Drift später ab.
  // introTtsTemplate wandert NICHT in die campaigns-Tabelle — es wird
  // unten beim Kalibrierungs-Insert verwendet.
  const { thumbnailImage, introTtsTemplate, ...rest } = body;
  const campaign = await createCampaign(auth.user.id, {
    ...rest,
    thumbnailImage:
      thumbnailImage === undefined
        ? undefined
        : (thumbnailImage as CampaignThumbnailImage | null),
  });

  // Best-effort: Bei aktivierter KI-Begrüßung die Video-Kalibrierung des
  // Webcam-Videos direkt anstoßen, damit sie beim ersten Run schon fertig
  // ist. Fehler brechen die Kampagnen-Erstellung nicht ab — der Start-
  // Endpoint fällt ohne fertige Kalibrierung auf den Direktpfad zurück.
  if (body.introEnabled && body.webcamMediaId) {
    try {
      const [existing] = await db
        .select({
          id: introCalibrations.id,
          status: introCalibrations.status,
          voiceStatus: introCalibrations.voiceStatus,
        })
        .from(introCalibrations)
        .where(eq(introCalibrations.mediaItemId, body.webcamMediaId))
        .limit(1);
      if (existing && existing.status === "ready" && existing.voiceStatus !== "ready") {
        // Kalibrierung fertig, aber noch keine Kampagnen-Stimme (Video aus
        // der Zeit vor per-Video-Training oder Trainings-Fehler) → Job neu
        // anstoßen; der Processor misst neu und trainiert die Stimme mit.
        await introCalibrationQueue().add(
          "intro-calibration",
          { calibrationId: existing.id },
          { jobId: `intro-calibration-${existing.id}-${Date.now()}` },
        );
      }
      // Fertige oder laufende Kalibrierung nicht zurücksetzen.
      if (!existing || existing.status === "failed") {
        const initialTemplate = introTtsTemplate ?? DEFAULT_TTS_TEMPLATE;
        const [calibration] = await db
          .insert(introCalibrations)
          .values({
            mediaItemId: body.webcamMediaId,
            userId: auth.user.id,
            status: "pending",
            ttsTemplate: initialTemplate,
          })
          .onConflictDoUpdate({
            target: introCalibrations.mediaItemId,
            set: {
              status: "pending",
              error: null,
              // Beim Retry-Weg (failed → pending) auch das Template
              // aktualisieren, wenn der Client eines mitgesendet hat.
              ...(introTtsTemplate ? { ttsTemplate: introTtsTemplate } : {}),
              updatedAt: sql`now()`,
            },
          })
          .returning();
        await introCalibrationQueue().add(
          "intro-calibration",
          { calibrationId: calibration.id },
          { jobId: `intro-calibration-${calibration.id}-${Date.now()}` },
        );
      }
    } catch (err) {
      console.error("[api/campaigns] intro calibration enqueue failed:", err);
    }
  }

  return NextResponse.json({ campaign }, { status: 201 });
}
