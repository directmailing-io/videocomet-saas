/**
 * Auth-Endpoint: Webcam-Share-Links für den eingeloggten User verwalten.
 *
 *   POST → erzeugt einen neuen Share-Link
 *   GET  → listet die eigenen Share-Links
 *
 * Die Public-Seite (Slug-Info + Submit) lebt unter /api/r/[slug]/*.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createShareLink,
  listShareLinksForUser,
  MAX_MAX_DURATION_SEC,
  MIN_MAX_DURATION_SEC,
} from "@/lib/db/queries/webcam-share";

const APP_URL = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
  /\/+$/,
  "",
);

const createSchema = z.object({
  title: z
    .string()
    .trim()
    .max(140)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  maxDurationSec: z
    .number()
    .int()
    .min(MIN_MAX_DURATION_SEC)
    .max(MAX_MAX_DURATION_SEC)
    .optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  const result = await createShareLink(auth.user.id, {
    title: parsed.data.title ?? null,
    maxDurationSec: parsed.data.maxDurationSec ?? 120,
    expiresAt: parsed.data.expiresAt ?? null,
  });
  if (!result.ok) {
    const status = result.code === "limit" ? 429 : 500;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(
    {
      slug: result.link.slug,
      numericId: result.link.numericId,
      url: `${APP_URL}/r/${result.link.slug}`,
      link: result.link,
    },
    { status: 201 },
  );
}

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const links = await listShareLinksForUser(auth.user.id);
  const now = Date.now();
  const enriched = links.map((l) => {
    let status: "open" | "used" | "expired" | "revoked" = "open";
    if (l.revokedAt) status = "revoked";
    else if (l.usedAt) status = "used";
    else if (l.expiresAt && l.expiresAt.getTime() <= now) status = "expired";
    return {
      ...l,
      status,
      url: `${APP_URL}/r/${l.slug}`,
    };
  });
  return NextResponse.json({ links: enriched });
}
