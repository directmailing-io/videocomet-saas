export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Default-Vercel-Timeout liegt bei 10 s — der Import braucht für ein 10-
// Folien-Deck typischerweise 8-15 s. Wir geben uns 60 s.
export const maxDuration = 60;

/**
 * POST /api/gslides/import
 *
 * Body: { publishedUrl: string }
 *
 * Antwort 200:
 *   {
 *     mode: "edit" | "pubembed",
 *     canonicalUrl: string,
 *     canonicalPubembedUrl: string,      // Legacy-Feld, gleich canonicalUrl
 *     totalSlides: number,
 *     placeholdersSubstitutable: boolean, // false bei pubembed → UI zeigt Warnung
 *     slides: Array<{
 *       slideIndex: number,
 *       thumbnailUrl: string | null,
 *       detectedPlaceholders: string[]
 *     }>
 *   }
 *
 * Fehler-Mapping:
 *   - 400 → Body unleserlich / leer
 *   - 404 → URL erkannt, aber Deck nicht erreichbar (nicht geteilt)
 *   - 502 → LibreOffice-/Puppeteer-Timeout, Bunny-Upload-Fehler etc.
 *
 * Auth: User-Session (Tenant-Guard via Lucia).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { GSlidesUrlError } from "@/lib/gslides/validate-url";
import {
  GSlidesImportError,
  importPublishedDeck,
} from "@/lib/gslides/import";

const bodySchema = z.object({
  publishedUrl: z.string().min(1).max(2048),
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
    const result = await importPublishedDeck(body.publishedUrl);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof GSlidesUrlError) {
      // Edit-URL ist semantisch „falsche Eingabe" → 422 mit Code, damit
      // das Frontend die hilfreiche Anleitung anzeigt.
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
    console.error("[api/gslides/import] unexpected:", err);
    return NextResponse.json(
      {
        error: "Import konnte nicht abgeschlossen werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }
}
