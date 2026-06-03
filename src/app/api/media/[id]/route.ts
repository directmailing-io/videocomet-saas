export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteMediaItem,
  getMediaItem,
  renameMediaItem,
} from "@/lib/db/queries/media";
import { deleteVideo } from "@/lib/bunny/stream";
import { deleteFile } from "@/lib/bunny/storage";
import { parseMediaUrl } from "@/lib/media-upload-service";

const renameSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(200),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  try {
    const updated = await renameMediaItem(
      params.id,
      auth.user.id,
      parsed.data.name,
    );
    if (!updated) {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, media: updated });
  } catch (err) {
    const code = err instanceof Error ? err.message : "internal";
    if (code === "name-empty") {
      return NextResponse.json(
        { error: "Name darf nicht leer sein." },
        { status: 400 },
      );
    }
    if (code === "name-too-long") {
      return NextResponse.json(
        { error: "Name ist zu lang (max. 200 Zeichen)." },
        { status: 400 },
      );
    }
    console.error("[api/media] rename failed:", err);
    return NextResponse.json(
      { error: "Umbenennen fehlgeschlagen." },
      { status: 500 },
    );
  }
}

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
