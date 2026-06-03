/**
 * Public-Endpoint (no auth): nimmt das aufgenommene Webcam-Video eines
 * Gastes entgegen und legt es in der Mediathek des Link-Owners ab.
 *
 * Flow:
 *  1. Slug nachschlagen (interner Lookup mit user_id)
 *  2. Status prüfen: muss offen sein (nicht revoked / used / expired)
 *  3. Multipart parsen: Feld `video` (≤100 MB, video/webm oder video/mp4)
 *  4. Upload nach Bunny Storage (`webcams/<userId>/<mediaItemId>.<ext>`)
 *  5. mediaItem mit type='webcam' für den Owner erzeugen
 *  6. Atomic-Mark-Used → wenn das verliert (race), lösche das eben erzeugte
 *     mediaItem und das Bunny-File und antworte 409.
 *
 * Idempotenz: zweiter Versuch erkennt `used_at IS NOT NULL` und gibt 409
 * mit klarer Fehlermeldung zurück.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createMediaItem,
  deleteMediaItem,
} from "@/lib/db/queries/media";
import {
  formatLinkId,
  getShareLinkBySlugInternal,
  getShareLinkBySlugPublic,
  markShareLinkUsed,
} from "@/lib/db/queries/webcam-share";
import { deleteFile, uploadFile } from "@/lib/bunny/storage";
import { getBunnyStorageEnv } from "@/lib/bunny/env";
import { probeVideoBufferDuration } from "@/lib/ffprobe";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_MIMES = ["video/webm", "video/mp4"] as const;

function extFromMime(mime: string): "webm" | "mp4" {
  const base = mime.toLowerCase().split(";")[0].trim();
  if (base === "video/mp4") return "mp4";
  return "webm";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  // 1. Status-Vorab-Check (cheap, public) — verhindert "Upload, dann 409".
  const publicInfo = await getShareLinkBySlugPublic(params.slug);
  if (!publicInfo) {
    return NextResponse.json({ error: "Link nicht gefunden." }, { status: 404 });
  }
  if (publicInfo.status !== "open") {
    const msg =
      publicInfo.status === "used"
        ? "Dieser Link wurde bereits verwendet."
        : publicInfo.status === "revoked"
          ? "Dieser Link wurde gesperrt."
          : "Dieser Link ist abgelaufen.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // 2. Internen Lookup für user_id
  const link = await getShareLinkBySlugInternal(params.slug);
  if (!link || link.usedAt || link.revokedAt) {
    return NextResponse.json(
      { error: "Dieser Link kann nicht mehr verwendet werden." },
      { status: 409 },
    );
  }

  // 3. Multipart parsen
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

  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Feld 'video' fehlt." },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "Aufnahme ist leer." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Datei zu groß (max. 100 MB)." },
      { status: 413 },
    );
  }
  const mimeBase = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIMES.includes(mimeBase as (typeof ALLOWED_MIMES)[number])) {
    return NextResponse.json(
      {
        error: `MIME-Typ ${file.type || "unbekannt"} nicht erlaubt (nur webm/mp4).`,
      },
      { status: 400 },
    );
  }

  // 4. Bunny-Upload
  // Pfadkonvention: webcams/<userId>/<mediaItemId>.<ext>
  // Wir generieren die mediaItemId vorab und übergeben sie an createMediaItem
  // damit Bunny-Pfad und DB-Row deterministisch zusammenpassen.
  const mediaItemId = randomUUID();
  const ext = extFromMime(mimeBase);
  const remotePath = `webcams/${link.userId}/${mediaItemId}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let uploaded: { url: string; remotePath: string };
  try {
    uploaded = await uploadFile({
      buffer,
      remotePath,
      contentType: mimeBase,
    });
  } catch (err) {
    console.error("[api/r/submit] bunny upload failed:", err);
    return NextResponse.json(
      {
        error: "Upload fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  // 5. MediaItem persistieren — Name aus Owner-Sicht: "Gast-Aufnahme · <Titel|Datum>"
  const displayDate = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  const linkIdTag = formatLinkId(link.numericId);
  const baseName = link.title?.trim()
    ? `Gast-Aufnahme ${linkIdTag} · ${link.title.trim()}`
    : `Gast-Aufnahme ${linkIdTag} · ${displayDate}`;

  // Dauer messen — sonst kann ein Run mit dieser Aufnahme später ein
  // Video erzeugen, das länger ist als die Webcam (Worker-Fallback 30s).
  let probedDurationSec: number | null = null;
  try {
    probedDurationSec = await probeVideoBufferDuration(buffer, ext);
  } catch (err) {
    console.warn(
      "[api/r/submit] ffprobe failed:",
      err instanceof Error ? err.message : err,
    );
  }

  let createdMediaId: string | null = null;
  try {
    const media = await createMediaItem(link.userId, {
      type: "webcam",
      name: baseName,
      filename: `${mediaItemId}.${ext}`,
      publicUrl: uploaded.url,
      durationSec: probedDurationSec,
      bytes: buffer.byteLength,
    });
    createdMediaId = media.id;
  } catch (err) {
    console.error("[api/r/submit] media insert failed:", err);
    // Best-effort Bunny-Cleanup
    try { await deleteFile(uploaded.remotePath); } catch { /* ignore */ }
    return NextResponse.json(
      { error: "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  // 6. Atomic-Mark-Used (Race-Schutz)
  const claimed = await markShareLinkUsed(params.slug, createdMediaId);
  if (!claimed) {
    // Jemand anderes war schneller (oder Link wurde in der Zwischenzeit revoked).
    // → das eben erzeugte mediaItem + Bunny-File wieder weg.
    try {
      await deleteMediaItem(createdMediaId, link.userId);
    } catch { /* ignore */ }
    try { await deleteFile(uploaded.remotePath); } catch { /* ignore */ }
    return NextResponse.json(
      { error: "Dieser Link wurde bereits verwendet." },
      { status: 409 },
    );
  }

  // Debug-Hinweis: damit man Bunny-Zone + Pfad im Log nachvollziehen kann
  const env = getBunnyStorageEnv();
  console.log(
    `[api/r/submit] success slug=${params.slug} owner=${link.userId} mediaId=${createdMediaId} bytes=${buffer.byteLength} zone=${env.zone} path=${remotePath}`,
  );

  return NextResponse.json(
    {
      ok: true,
      mediaId: createdMediaId,
    },
    { status: 201 },
  );
}
