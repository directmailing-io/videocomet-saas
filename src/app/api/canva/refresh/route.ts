export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/canva/refresh
 *
 * Body: { pptxMediaId: string, slideIndex: number }
 *
 * Antwort 200:
 *   {
 *     thumbnailUrl: string | null,
 *     detectedPlaceholders: string[],
 *     lastFetchedAt: string  // ISO-8601
 *   }
 *
 * Fehler-Mapping: identisch zu /api/canva/process.
 *
 * Verwendung: „Aktualisieren"-Button im Segment-Editor. Holt nur die
 * angegebene Folie, nicht das ganze Deck.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getMediaItem } from "@/lib/db/queries/media";
import {
  CanvaProcessError,
  fetchPptxBuffer,
  refreshCanvaSlide,
} from "@/lib/canva/process";

const bodySchema = z.object({
  pptxMediaId: z.string().uuid(),
  slideIndex: z.number().int().min(0).max(999),
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
    console.error("[api/canva/refresh] fetch unexpected:", err);
    return NextResponse.json(
      {
        error: "PPTX-Download fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  // 3) Refresh.
  try {
    const result = await refreshCanvaSlide(
      pptxBuf,
      body.pptxMediaId,
      body.slideIndex,
    );
    return NextResponse.json(result, { status: 200 });
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
    console.error("[api/canva/refresh] unexpected:", err);
    return NextResponse.json(
      {
        error: "Folie konnte nicht aktualisiert werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }
}
