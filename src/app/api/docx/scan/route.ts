export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/docx/scan — scans a Google-Docs template for placeholders and
 * marker images.
 *
 * Body: `{ "googleDocsUrl": string }`
 *
 * Workflow:
 *   1. Validate that the URL is a `docs.google.com/document/...` link.
 *   2. Fetch the DOCX export via `fetchGoogleDocAsDocx`.
 *   3. Open the DOCX as a ZIP (`pizzip`, already used elsewhere in the repo)
 *      and read `word/document.xml`.
 *   4. Strip XML tags and collect every `{{name}}` placeholder.
 *   5. SHA-256 every file under `word/media/*` and check whether the QR-marker
 *      and the thumbnail-marker (hashes of `generateMarkerPng("qr"|"thumb")`)
 *      are present.
 *
 * The marker SHAs are computed lazily at module load and memoised — the
 * markers are byte-stable so a single hash per process is enough.
 *
 * Response shape:
 *   {
 *     placeholders: string[],   // unique, in first-seen order
 *     hasQrMarker: boolean,
 *     hasThumbMarker: boolean,
 *     imageCount: number,       // number of word/media/* entries
 *   }
 *
 * All user-facing error strings are in German.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import PizZip from "pizzip";

import { requireUserApi } from "@/lib/auth-guard";
import {
  generateMarkerPng,
  getMarkerSha256,
} from "@/lib/marker-placeholders";
import { fetchGoogleDocAsDocx } from "@/worker/lib/google-docs";

// ── Marker SHA cache (module-level) ─────────────────────────────────────────

let markerShasPromise: Promise<{ qr: string; thumb: string }> | null = null;

function loadMarkerShas(): Promise<{ qr: string; thumb: string }> {
  if (!markerShasPromise) {
    markerShasPromise = (async () => {
      const [qrBuf, thumbBuf] = await Promise.all([
        generateMarkerPng("qr"),
        generateMarkerPng("thumb"),
      ]);
      return {
        qr: getMarkerSha256(qrBuf),
        thumb: getMarkerSha256(thumbBuf),
      };
    })().catch((err) => {
      // Reset on failure so a transient error can be retried.
      markerShasPromise = null;
      throw err;
    });
  }
  return markerShasPromise;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const GOOGLE_DOCS_HOST = "docs.google.com";

function isGoogleDocsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname !== GOOGLE_DOCS_HOST) return false;
  return parsed.pathname.startsWith("/document/");
}

/**
 * Extract unique `{{placeholder}}` names from a DOCX `document.xml`.
 *
 * Word may split a single `{{firstName}}` across multiple `<w:r>` runs (e.g.
 * spell-check). We follow the same strategy as
 * `worker/lib/docx.ts#joinSplitPlaceholders`: capture everything between
 * `{{` and `}}`, strip inline XML tags, then validate the cleaned name.
 *
 * Only names matching `/^[a-zA-Z0-9_]+$/` are kept (matches the worker's
 * placeholder convention) so accidental braces in formatting metadata don't
 * leak into the result.
 */
function extractPlaceholdersFromXml(xml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const cleaned = match[1].replace(/<[^>]+>/g, "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

interface MediaScan {
  imageCount: number;
  shaSet: Set<string>;
}

function scanMedia(zip: PizZip): MediaScan {
  const entries = zip.file(/^word\/media\//);
  const shaSet = new Set<string>();
  for (const entry of entries) {
    const data = entry.asNodeBuffer();
    const hash = createHash("sha256").update(data).digest("hex");
    shaSet.add(hash);
  }
  return { imageCount: entries.length, shaSet };
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Ungültiger JSON-Body." },
      { status: 400 },
    );
  }

  const googleDocsUrl =
    body && typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).googleDocsUrl
      : undefined;

  if (typeof googleDocsUrl !== "string" || googleDocsUrl.length === 0) {
    return NextResponse.json(
      { error: "Feld 'googleDocsUrl' fehlt." },
      { status: 400 },
    );
  }

  if (!isGoogleDocsUrl(googleDocsUrl)) {
    return NextResponse.json(
      {
        error:
          "Ungültige Google-Docs-URL. Erwartet wird ein Link der Form " +
          "https://docs.google.com/document/...",
      },
      { status: 400 },
    );
  }

  // Fetch the DOCX from Google. Any failure here is reported as a 502 with a
  // German-language hint about sharing.
  let docxBuffer: Buffer;
  try {
    docxBuffer = await fetchGoogleDocAsDocx(googleDocsUrl);
  } catch (err) {
    console.error("[api/docx/scan] fetch failed:", err);
    return NextResponse.json(
      {
        error:
          "Dokument konnte nicht geladen werden. Ist der Link öffentlich freigegeben?",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  try {
    const zip = new PizZip(docxBuffer);

    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      return NextResponse.json(
        { error: "Ungültiges DOCX: 'word/document.xml' fehlt." },
        { status: 500 },
      );
    }
    const xml = documentXmlFile.asText();

    const placeholders = extractPlaceholdersFromXml(xml);
    const { imageCount, shaSet } = scanMedia(zip);

    const { qr: qrSha, thumb: thumbSha } = await loadMarkerShas();

    return NextResponse.json({
      placeholders,
      hasQrMarker: shaSet.has(qrSha),
      hasThumbMarker: shaSet.has(thumbSha),
      imageCount,
    });
  } catch (err) {
    console.error("[api/docx/scan] parse failed:", err);
    return NextResponse.json(
      {
        error: "DOCX konnte nicht ausgewertet werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
