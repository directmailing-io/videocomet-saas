/**
 * GET /api/media/[id]/signed-url
 *
 * Returns a short-lived, token-authenticated Bunny Stream URL for a media
 * item the caller owns. Used by the Mediathek preview and any other
 * surface that needs to embed an HLS playlist behind Bunny's pullzone
 * token-auth.
 *
 * Behaviour:
 *   - Auth-gated via `requireUserApi`.
 *   - Ownership-checked via `getMediaItem(id, userId)`.
 *   - Only Bunny Stream URLs (vz-*.b-cdn.net) are signed; storage CDN URLs
 *     (videocomet-pdf.b-cdn.net, …) are returned as-is so webcam recordings
 *     keep working unchanged.
 *   - Default TTL = 1h. Frontend re-fetches on demand.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getMediaItem } from "@/lib/db/queries/media";
import {
  signStreamHlsUrl,
  isBunnyStreamUrl,
  getBunnyStreamEmbedUrl,
  DEFAULT_HLS_SIGN_TTL_SEC,
} from "@/lib/bunny/sign-url";
import { presentStorageUrl } from "@/lib/bunny/private-storage";

export async function GET(
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

  const original = media.publicUrl;
  const isStream = isBunnyStreamUrl(original);

  // Bunny-Stream-Videos rendern wir bevorzugt als iframe-Embed — Bunny's
  // eigener Player hat eigene Auth-Logik und braucht keinen Token-Key.
  // Sign-Helper als Fallback (wenn Embed-URL nicht ableitbar oder
  // BUNNY_STREAM_TOKEN_AUTH_KEY gesetzt ist).
  // Storage-URLs in token-geschützten Ordnern (Webcam, Gast-Aufnahmen,
  // Intro) bekommen hier ihren Browser-Token (seit 2026-09-02).
  let url = presentStorageUrl(original);
  let embed = false;
  if (isStream) {
    const embedUrl = getBunnyStreamEmbedUrl(original);
    if (embedUrl) {
      url = embedUrl;
      embed = true;
    } else {
      url = signStreamHlsUrl(original, DEFAULT_HLS_SIGN_TTL_SEC);
    }
  }

  return NextResponse.json(
    {
      url,
      embed,
      signed: url !== original && !embed,
      expiresInSec: DEFAULT_HLS_SIGN_TTL_SEC,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
