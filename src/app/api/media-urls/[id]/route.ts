export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { deleteMediaUrl, getMediaUrl } from "@/lib/media-urls/repo";
import { deleteFile } from "@/lib/bunny/storage";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const item = await getMediaUrl(id, auth.user.id);
  if (!item) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const deleted = await deleteMediaUrl(id, auth.user.id);
  if (!deleted) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  // Best-effort Bunny-Cleanup. Wenn das fehlschlaegt, bleibt das Bild
  // als verwaister Bunny-Asset liegen — der naechtliche Cleanup-Cron
  // raeumt das spaeter auf.
  if (deleted.previewBunnyPath) {
    deleteFile(deleted.previewBunnyPath).catch((err) => {
      console.warn(
        `[media-urls] bunny cleanup failed for ${deleted.previewBunnyPath}:`,
        err,
      );
    });
  }
  return NextResponse.json({ ok: true });
}
