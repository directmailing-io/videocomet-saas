export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createMediaUrl,
  getMediaUrlByHash,
  listUserMediaUrls,
} from "@/lib/media-urls/repo";
import { normalizeUrl } from "@/lib/media-urls/normalize";
import { detectUrlType } from "@/lib/media-urls/detect-type";
import { assertUrlIsSafe, SsrfBlockedError } from "@/lib/media-urls/ssrf-guard";
import { urlPreviewQueue } from "@/worker/url-preview-queue";

const POST_BODY = z.object({
  url: z
    .string()
    .trim()
    .min(8, "URL ist zu kurz")
    .max(2048, "URL ist zu lang"),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
});

const MAX_URLS_PER_USER = 200;

export async function GET(_req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const items = await listUserMediaUrls(auth.user.id);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = POST_BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  // 1. URL normalisieren.
  let canonical: string;
  let urlHash: string;
  try {
    const norm = normalizeUrl(parsed.data.url);
    canonical = norm.canonical;
    urlHash = norm.hash;
  } catch {
    return NextResponse.json(
      { error: "Ungueltige URL — bitte vollstaendigen Link inkl. https:// eingeben." },
      { status: 400 },
    );
  }

  // 2. SSRF-Check VOR DB-Insert.
  try {
    await assertUrlIsSafe(canonical);
  } catch (err) {
    const msg = err instanceof SsrfBlockedError ? err.reason : "URL nicht erlaubt";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 3. Quota-Check.
  const existing = await listUserMediaUrls(auth.user.id);
  if (existing.length >= MAX_URLS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum von ${MAX_URLS_PER_USER} URLs erreicht.` },
      { status: 400 },
    );
  }

  // 4. Duplicate-Check.
  const dupe = await getMediaUrlByHash(auth.user.id, urlHash);
  if (dupe) {
    return NextResponse.json(
      { error: "Diese URL ist bereits gespeichert.", existingId: dupe.id },
      { status: 409 },
    );
  }

  // 5. Auto-Detect.
  const detected = detectUrlType(parsed.data.url);
  const fallbackTitle =
    parsed.data.title?.trim() ||
    canonical.replace(/^https?:\/\//, "").slice(0, 80);

  // 6. Insert.
  const created = await createMediaUrl({
    userId: auth.user.id,
    url: parsed.data.url,
    urlHash,
    type: detected.type,
    title: fallbackTitle,
    description: parsed.data.description ?? null,
    externalResourceId: detected.externalResourceId,
    previewStatus: "pending",
  });

  // 7. Preview-Job enqueuen (best-effort — wenn Redis tot, UI zeigt
  //    status=pending und User kann via Refresh-Button retriggern).
  try {
    await urlPreviewQueue().add(
      `preview-${created.id}`,
      {
        mediaUrlId: created.id,
        userId: auth.user.id,
        url: parsed.data.url,
        type: detected.type,
      },
      { priority: 5 },
    );
  } catch (err) {
    console.warn("[media-urls] enqueue failed:", err);
  }

  return NextResponse.json({ item: created }, { status: 201 });
}
