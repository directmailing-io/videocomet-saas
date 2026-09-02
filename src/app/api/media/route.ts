export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createMediaItem,
  listUserMedia,
  type MediaType,
} from "@/lib/db/queries/media";
import { uploadMediaFile, type MediaKind } from "@/lib/media-upload-service";
import { validateUpload, type UploadKind } from "@/lib/upload";
import { sniffImage } from "@/lib/upload-sniff";
import { addBunnyAssetRef } from "@/lib/db/queries/bunny-assets";
import { ensureIntroCalibration } from "@/lib/intro-calibration-enqueue";
import { presentMediaItem, presentStorageUrl, presentStorageUrlOrNull } from "@/lib/bunny/private-storage";

const MEDIA_TYPES: ReadonlyArray<MediaType> = [
  "webcam",
  "image",
  "video",
  "logo",
];

function isMediaKind(value: string): value is MediaKind {
  return MEDIA_TYPES.includes(value as MediaType);
}

/**
 * Maps the media kind to the upload-validation kind. "video" uploads
 * follow the same constraints as webcam uploads.
 */
function toValidationKind(kind: MediaKind): UploadKind {
  if (kind === "video" || kind === "webcam") return "webcam";
  if (kind === "logo") return "logo";
  return "image";
}

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Support both `?type=webcam` (single) and `?type=webcam,video` (CSV).
  // The CSV form is used e.g. by the campaign wizard so users can select
  // both a webcam recording and a directly-uploaded video from one picker.
  const typeParam = req.nextUrl.searchParams.get("type");
  let type: MediaType | MediaType[] | undefined;
  if (typeParam) {
    const raw = typeParam
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (raw.length === 0) {
      type = undefined;
    } else {
      for (const v of raw) {
        if (!MEDIA_TYPES.includes(v as MediaType)) {
          return NextResponse.json(
            { error: "Ungültiger type-Parameter." },
            { status: 400 },
          );
        }
      }
      const parsed = raw as MediaType[];
      type = parsed.length === 1 ? parsed[0] : parsed;
    }
  }

  const items = await listUserMedia(auth.user.id, type);
  // Webcam-Aufnahmen liegen in einem token-geschützten Ordner → für den
  // Browser signieren (DB behält die unsignierte URL).
  return NextResponse.json({ items: items.map(presentMediaItem) });
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

  const kindRaw = form.get("kind");
  const file = form.get("file");
  const durationSecRaw = form.get("durationSec");
  let clientDurationSec: number | null = null;
  if (typeof durationSecRaw === "string" && durationSecRaw.length > 0) {
    const parsed = Number(durationSecRaw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 7200) {
      clientDurationSec = Math.round(parsed);
    }
  }

  if (typeof kindRaw !== "string" || !isMediaKind(kindRaw)) {
    return NextResponse.json(
      { error: "Feld 'kind' fehlt oder ist ungültig." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Feld 'file' fehlt." },
      { status: 400 },
    );
  }

  const kind: MediaKind = kindRaw;
  const filename = file.name || "upload";
  let mime = file.type || "application/octet-stream";
  const bytes = file.size;

  const validation = validateUpload({
    sizeBytes: bytes,
    mime,
    kind: toValidationKind(kind),
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Bilder/Logos: Inhalt per Magic Bytes verifizieren — der Browser-MIME
  // ist fälschbar. Ab hier gilt der VERIFIZIERTE Typ (bestimmt auch die
  // Datei-Endung im Storage). Gefährliche SVGs werden abgelehnt.
  if (kind === "image" || kind === "logo") {
    const sniffed = sniffImage(buffer);
    if (!sniffed) {
      return NextResponse.json(
        {
          error:
            "Dateiinhalt ist kein unterstütztes Bild (PNG, JPEG, WebP oder SVG ohne aktive Inhalte).",
        },
        { status: 400 },
      );
    }
    const reValidation = validateUpload({
      sizeBytes: bytes,
      mime: sniffed.mime,
      kind: toValidationKind(kind),
    });
    if (!reValidation.ok) {
      return NextResponse.json({ error: reValidation.error }, { status: 400 });
    }
    mime = sniffed.mime;
  }

  try {
    const uploaded = await uploadMediaFile({
      userId: auth.user.id,
      kind,
      filename,
      mime,
      buffer,
    });

    const media = await createMediaItem(auth.user.id, {
      type: kind,
      name: filename,
      filename,
      publicUrl: uploaded.publicUrl,
      durationSec: uploaded.durationSec ?? clientDurationSec,
      bytes: uploaded.bytes,
      // ffprobe-gemessene Pixel-Dimensionen (Webcam + Video-Uploads). Bei
      // image / logo bleibt NULL — unkritisch, da das Aspect für die
      // Render-Pipeline dort keine Rolle spielt.
      width: uploaded.width,
      height: uploaded.height,
    });

    // Bunny-Asset-Ref erst HIER setzen — wir brauchen `media.id`. Wenn
    // `bunnyAssetId` fehlt (z.B. image/logo, oder Tracking-Fehler im
    // Service), überspringen wir leise. Der Orphan-Sweeper (Paket E) räumt
    // sonst auf.
    if (uploaded.bunnyAssetId) {
      try {
        await addBunnyAssetRef(uploaded.bunnyAssetId, "media_item", media.id);
      } catch (err) {
        console.warn(
          "[api/media] addBunnyAssetRef failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Webcam-Aufnahmen sofort analysieren (Anrede/Pause/erster Satz), damit
    // der User direkt nach der Aufnahme Feedback bekommt — nicht erst beim
    // Kampagnen-Start. Best-effort, bricht den Upload nie ab.
    if (kind === "webcam") {
      await ensureIntroCalibration(auth.user.id, media.id);
    }

    return NextResponse.json({ media: presentMediaItem(media) }, { status: 201 });
  } catch (err) {
    console.error("[api/media] upload failed:", err);
    return NextResponse.json(
      {
        error: "Upload fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
