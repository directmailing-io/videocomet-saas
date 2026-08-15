export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/brand/logo-import — kopiert ein Logo von einer fremden
 * Website dauerhaft auf unseren Storage (Landingpage v3, Konzept 3.2:
 * „SVG bevorzugt, sonst PNG auf unseren Storage kopieren").
 *
 * Body: { url: string } — der vom User gewählte Logo-Kandidat.
 * Response 200: { url: string } — permanente Bunny-CDN-URL.
 *
 * Guards: requireUserApi, assertUrlIsSafe (inkl. jedem Redirect-Hop),
 * 5 s Timeout, content-type image/* (SVG erlaubt), max. 2 MB.
 * Ablage: users/<userId>/brand/logo-<uuid>.<ext>
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { assertUrlIsSafe } from "@/lib/media-urls/ssrf-guard";
import { uploadFile } from "@/lib/bunny/storage";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const bodySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "URL muss mit http:// oder https:// beginnen." },
    ),
});

/** Erlaubte Bildtypen → Datei-Endung. */
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/**
 * Fetch mit manuellem Redirect-Following: jeder Hop läuft erneut durch
 * den SSRF-Guard — sonst könnte eine harmlose öffentliche URL per
 * Redirect auf interne Adressen zeigen.
 */
async function fetchWithSafeRedirects(rawUrl: string): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlIsSafe(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/*",
          "user-agent":
            "Mozilla/5.0 (compatible; VideocometBrandBot/1.0; +https://videocomet.de)",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Zu viele Weiterleitungen.");
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetchWithSafeRedirects(body.url);
  } catch {
    return NextResponse.json(
      {
        error:
          "Wir konnten das Logo nicht laden. Du kannst es auch direkt als Datei hochladen.",
      },
      { status: 422 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          "Wir konnten das Logo nicht laden. Du kannst es auch direkt als Datei hochladen.",
      },
      { status: 422 },
    );
  }

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!contentType.startsWith("image/") || !ext) {
    return NextResponse.json(
      {
        error:
          "Die Adresse liefert kein unterstütztes Bildformat. Bitte lade dein Logo direkt hoch.",
      },
      { status: 415 },
    );
  }

  // Größen-Guard: Content-Length früh prüfen, danach den tatsächlichen
  // Body (Header kann fehlen oder lügen).
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "Das Logo ist größer als 2 MB. Bitte lade eine kleinere Datei hoch." },
      { status: 413 },
    );
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    return NextResponse.json(
      {
        error:
          "Wir konnten das Logo nicht laden. Du kannst es auch direkt als Datei hochladen.",
      },
      { status: 422 },
    );
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "Das Logo ist größer als 2 MB. Bitte lade eine kleinere Datei hoch." },
      { status: 413 },
    );
  }

  try {
    const upload = await uploadFile({
      buffer,
      remotePath: `users/${auth.user.id}/brand/logo-${randomUUID()}.${ext}`,
      contentType,
    });
    return NextResponse.json({ url: upload.url });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Das Logo konnte nicht gespeichert werden. Bitte versuche es gleich noch einmal.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
