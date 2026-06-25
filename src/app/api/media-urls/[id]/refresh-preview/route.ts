export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getMediaUrl, updateMediaUrlPreview } from "@/lib/media-urls/repo";
import { urlPreviewQueue } from "@/worker/url-preview-queue";

export async function POST(
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

  // Status zurueck auf pending damit die UI sofort das Skeleton zeigt.
  await updateMediaUrlPreview(id, {
    previewStatus: "pending",
    lastError: null,
  });

  try {
    await urlPreviewQueue().add(
      `preview-refresh-${item.id}`,
      {
        mediaUrlId: item.id,
        userId: auth.user.id,
        url: item.url,
        type: item.type,
      },
      { priority: 1 }, // User-getriggert → hoechste Prio.
    );
  } catch (err) {
    console.error("[media-urls/refresh] enqueue failed:", err);
    return NextResponse.json(
      { error: "Refresh konnte nicht gestartet werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
