export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/gslides/refresh
 *
 * Body: { publishedUrl: string, slideIndex: number }
 *
 * Antwort 200:
 *   {
 *     thumbnailUrl: string | null,
 *     detectedPlaceholders: string[],
 *     lastFetchedAt: string  // ISO-8601
 *   }
 *
 * Fehler-Mapping: identisch zu /api/gslides/import.
 *
 * Verwendung: „Aktualisieren"-Button im Segment-Editor. Holt nur die
 * angegebene Folie, nicht das ganze Deck — schneller (~2 s).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { GSlidesUrlError } from "@/lib/gslides/validate-url";
import {
  GSlidesImportError,
  refreshSlide,
} from "@/lib/gslides/import";

const bodySchema = z.object({
  publishedUrl: z.string().min(1).max(2048),
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

  try {
    const result = await refreshSlide(body.publishedUrl, body.slideIndex);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof GSlidesUrlError) {
      const status = err.code === "edit-url" ? 422 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (err instanceof GSlidesImportError) {
      const status =
        err.code === "not-published"
          ? 404
          : err.code === "bad-index"
            ? 400
            : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[api/gslides/refresh] unexpected:", err);
    return NextResponse.json(
      {
        error: "Folie konnte nicht aktualisiert werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }
}
