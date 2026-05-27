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

  const typeParam = req.nextUrl.searchParams.get("type");
  let type: MediaType | undefined;
  if (typeParam) {
    if (!MEDIA_TYPES.includes(typeParam as MediaType)) {
      return NextResponse.json(
        { error: "Ungültiger type-Parameter." },
        { status: 400 },
      );
    }
    type = typeParam as MediaType;
  }

  const items = await listUserMedia(auth.user.id, type);
  return NextResponse.json({ items });
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
  const mime = file.type || "application/octet-stream";
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
      durationSec: uploaded.durationSec,
      bytes: uploaded.bytes,
    });

    return NextResponse.json({ media }, { status: 201 });
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
