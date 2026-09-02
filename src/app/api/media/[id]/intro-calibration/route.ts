export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { introCalibrations } from "@/lib/db/schema";
import { getMediaItem } from "@/lib/db/queries/media";
import { introCalibrationQueue } from "@/worker/intro-queue";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";

/**
 * GET /api/media/[id]/intro-calibration — Status + Analyse-Felder der
 * Intro-Kalibrierung dieses Webcam-Videos (fürs UI-Polling).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const [calibration] = await db
    .select()
    .from(introCalibrations)
    .where(eq(introCalibrations.mediaItemId, params.id))
    .limit(1);

  return NextResponse.json({ calibration: calibration ?? null });
}

/**
 * POST /api/media/[id]/intro-calibration — Kalibrierung (neu) starten.
 * Upsert der Row auf status='pending' + Enqueue des Analyse-Jobs.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let mediaType: string;
  try {
    const media = await getMediaItem(params.id, auth.user.id);
    mediaType = media.type;
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  if (mediaType !== "webcam" && mediaType !== "video") {
    return NextResponse.json(
      { error: "Nur Webcam- oder Video-Aufnahmen können kalibriert werden." },
      { status: 400 },
    );
  }

  const [calibration] = await db
    .insert(introCalibrations)
    .values({
      mediaItemId: params.id,
      userId: auth.user.id,
      status: "pending",
      ttsTemplate: DEFAULT_TTS_TEMPLATE,
    })
    .onConflictDoUpdate({
      target: introCalibrations.mediaItemId,
      set: {
        status: "pending",
        error: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  try {
    await introCalibrationQueue().add(
      "intro-calibration",
      { calibrationId: calibration.id },
      { jobId: `intro-calibration-${calibration.id}-${Date.now()}` },
    );
  } catch (err) {
    console.error("[api/intro-calibration] enqueue failed:", err);
    return NextResponse.json(
      { error: "Analyse konnte nicht gestartet werden." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, calibration });
}

const patchSchema = z.object({
  ttsTemplate: z
    .string()
    .trim()
    .min(1, "Vorlage darf nicht leer sein.")
    .max(200, "Vorlage ist zu lang (max. 200 Zeichen).")
    .refine(
      (v) => v.includes("{vorname}") || v.includes("{nachname}"),
      {
        message:
          "Die Vorlage muss mindestens {vorname} oder {nachname} enthalten.",
      },
    ),
});

/**
 * PATCH /api/media/[id]/intro-calibration — Begrüßungs-Vorlage anpassen.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
      },
      { status: 400 },
    );
  }

  const [calibration] = await db
    .update(introCalibrations)
    .set({ ttsTemplate: parsed.data.ttsTemplate, updatedAt: new Date() })
    .where(eq(introCalibrations.mediaItemId, params.id))
    .returning();
  if (!calibration) {
    return NextResponse.json(
      { error: "Keine Kalibrierung vorhanden." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, calibration });
}
