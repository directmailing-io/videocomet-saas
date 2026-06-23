export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 50 MB pptx ≈ 1-3s Upload; großzügiges Timeout für langsame Connections.
export const maxDuration = 60;

/**
 * POST /api/canva/upload
 *
 * Multipart-Form mit Feld `file` (PPTX).
 *
 * Antwort 200 / 201:
 *   {
 *     mediaId: string,
 *     publicUrl: string,
 *     fileName: string
 *   }
 *
 * Frontend-Hilfsendpoint für den Canva-Import-Dialog. Lädt die hochgeladene
 * PPTX-Datei nach Bunny Storage und legt einen `media_items`-Eintrag an,
 * den `/api/canva/process` und `/api/canva/refresh` anschließend via
 * `getMediaItem(pptxMediaId, userId)` lesen können.
 *
 * Hinweis: Der DB-Enum `media_type` umfasst aktuell nur webcam/image/video/
 * logo. Bis eine eigene Migration „pptx"-Type ergänzt, legen wir den
 * Eintrag pragmatisch als `image` an — das hat keine Auswirkung auf die
 * Render-Pipeline, da die Canva-Pipeline ausschließlich über `pptxMediaId`
 * + `pptxPublicUrl` arbeitet und niemals über den media_type-Filter.
 *
 * Auth: User-Session (Tenant-Guard via Lucia).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUserApi } from "@/lib/auth-guard";
import { createMediaItem } from "@/lib/db/queries/media";
import { uploadFile } from "@/lib/bunny/storage";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_PPTX_BYTES = 50 * 1024 * 1024; // 50 MB

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültiger multipart-Body.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Feld 'file' fehlt." },
      { status: 400 },
    );
  }

  const filename = file.name || "deck.pptx";
  const mime = (file.type || PPTX_MIME).toLowerCase();
  const bytes = file.size;

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return NextResponse.json(
      { error: "Datei ist leer oder ungültig." },
      { status: 400 },
    );
  }
  if (bytes > MAX_PPTX_BYTES) {
    return NextResponse.json(
      {
        error: `Datei zu groß (${(bytes / 1024 / 1024).toFixed(1)} MB). Maximum: 50 MB.`,
      },
      { status: 400 },
    );
  }
  // Locker prüfen: pptx-MIME ODER .pptx-Endung. Browser sind hier
  // inkonsistent (Safari schickt häufig "application/octet-stream").
  const looksLikePptx =
    mime.startsWith("application/vnd.openxmlformats-officedocument.presentationml") ||
    mime === "application/octet-stream" ||
    /\.pptx$/i.test(filename);
  if (!looksLikePptx) {
    return NextResponse.json(
      {
        error:
          "Nur PowerPoint-Dateien (.pptx) sind erlaubt. Exportiere dein Canva-Design als PPTX und lade es erneut hoch.",
      },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Bunny-Pfad: users/<userId>/canva/<uuid>-<safe>.pptx
  const dotIdx = filename.lastIndexOf(".");
  const rawBase = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const safeBase = slugify(rawBase) || "deck";
  const remotePath = `users/${auth.user.id}/canva/${randomUUID()}-${safeBase}.pptx`;

  let uploadResult: { url: string; remotePath: string };
  try {
    uploadResult = await uploadFile({
      buffer,
      remotePath,
      contentType: PPTX_MIME,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api/canva/upload] bunny upload failed:", err);
    return NextResponse.json(
      {
        error: "Upload nach Bunny fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  // media_items-Eintrag anlegen, damit `/api/canva/process` ihn via
  // `getMediaItem(id, userId)` lesen kann. type="image" ist hier rein
  // formal — der echte Inhalt ist PPTX, aber der enum gibt nichts anderes
  // her (siehe File-Header-Kommentar).
  try {
    const media = await createMediaItem(auth.user.id, {
      type: "image",
      name: filename,
      filename,
      publicUrl: uploadResult.url,
      durationSec: null,
      bytes,
      width: null,
      height: null,
    });
    return NextResponse.json(
      {
        mediaId: media.id,
        publicUrl: media.publicUrl,
        fileName: media.filename,
      },
      { status: 201 },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api/canva/upload] createMediaItem failed:", err);
    return NextResponse.json(
      {
        error: "Konnte Mediathek-Eintrag nicht erstellen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
