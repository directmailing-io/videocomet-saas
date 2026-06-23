export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// LibreOffice braucht für ein 10-Folien-Deck typischerweise 8-15 s. Wir
// geben uns 60 s.
export const maxDuration = 60;

/**
 * POST /api/canva/process
 *
 * Body: { pptxMediaId: string }
 *
 * Antwort 200:
 *   {
 *     slideCount: number,
 *     fileName: string | null,
 *     slides: Array<{
 *       slideIndex: number,
 *       thumbnailUrl: string | null,
 *       detectedPlaceholders: string[]
 *     }>
 *   }
 *
 * Fehler-Mapping:
 *   - 400 → Body unleserlich / leer
 *   - 404 → MediaItem nicht gefunden / nicht im Owner
 *   - 422 → PPTX kaputt (kein ZIP, leeres Deck, zu groß)
 *   - 502 → LibreOffice-Timeout, Bunny-Upload-Fehler etc.
 *
 * Auth: User-Session (Tenant-Guard via Lucia).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getMediaItem } from "@/lib/db/queries/media";
import {
  CanvaProcessError,
  fetchPptxBuffer,
  processPptx,
} from "@/lib/canva/process";

const bodySchema = z.object({
  pptxMediaId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // 1) Ownership-Check.
  let mediaItem: Awaited<ReturnType<typeof getMediaItem>>;
  try {
    mediaItem = await getMediaItem(body.pptxMediaId, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "PPTX nicht gefunden." },
      { status: 404 },
    );
  }

  if (!mediaItem.publicUrl) {
    return NextResponse.json(
      { error: "PPTX hat keine öffentliche URL." },
      { status: 422 },
    );
  }

  // 2) PPTX vom Bunny-CDN holen.
  let pptxBuf: Buffer;
  try {
    pptxBuf = await fetchPptxBuffer(mediaItem.publicUrl);
  } catch (err) {
    if (err instanceof CanvaProcessError) {
      const status =
        err.code === "not-found"
          ? 404
          : err.code === "too-large" || err.code === "not-pptx"
            ? 422
            : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[api/canva/process] fetch unexpected:", err);
    return NextResponse.json(
      {
        error: "PPTX-Download fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  // 3) Processen.
  try {
    const result = await processPptx(pptxBuf, body.pptxMediaId);
    return NextResponse.json(
      {
        slideCount: result.slideCount,
        fileName: mediaItem.filename || mediaItem.name || null,
        slides: result.slides,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof CanvaProcessError) {
      const status =
        err.code === "not-pptx" || err.code === "too-large" ? 422 : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[api/canva/process] unexpected:", err);
    return NextResponse.json(
      {
        error: "PPTX-Verarbeitung fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }
}
