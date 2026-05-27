export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { deleteMediaItem, getMediaItem } from "@/lib/db/queries/media";
import { deleteVideo } from "@/lib/bunny/stream";
import { deleteFile } from "@/lib/bunny/storage";
import { parseMediaUrl } from "@/lib/media-upload-service";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let media;
  try {
    media = await getMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Best-effort Bunny cleanup. We still proceed with DB delete even if the
  // remote delete fails (file orphans are cheaper than dangling DB rows).
  try {
    const info = parseMediaUrl(media.publicUrl);
    if (info.kind === "stream" && info.videoId) {
      await deleteVideo(info.videoId);
    } else if (info.kind === "storage" && info.storagePath) {
      await deleteFile(info.storagePath);
    } else {
      console.warn(
        `[api/media] could not determine bunny backend for url=${media.publicUrl}`,
      );
    }
  } catch (err) {
    console.error(
      "[api/media] bunny cleanup failed (continuing with DB delete):",
      err,
    );
  }

  try {
    await deleteMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
