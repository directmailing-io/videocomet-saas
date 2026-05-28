/**
 * Google Docs fetcher.
 *
 * Helpers to turn a "share" URL like
 *   https://docs.google.com/document/d/<ID>/edit?usp=sharing
 * into the public DOCX export endpoint
 *   https://docs.google.com/document/d/<ID>/export?format=docx
 * and download the bytes.
 *
 * Each DOCX template is cached in-memory for `CACHE_TTL_MS` (5 minutes) so a
 * burst of leads in the same Run does not hit Google's export endpoint
 * thousands of times. The cache key is the canonicalised export URL (i.e.
 * derived from the doc ID), not the raw input URL, so `/edit` and `/export`
 * variants collapse to the same entry.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  buffer: Buffer;
  fetchedAt: number;
}

interface HtmlCacheEntry {
  html: string;
  fetchedAt: number;
}

// Module-level cache. The worker is a long-running process, so this survives
// across BullMQ jobs.
const docxCache = new Map<string, CacheEntry>();
const htmlCache = new Map<string, HtmlCacheEntry>();

const ALLOWED_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

/**
 * Extracts the Google-Docs document ID from any of the common URL forms:
 *
 *   - https://docs.google.com/document/d/<ID>/edit
 *   - https://docs.google.com/document/d/<ID>/edit?usp=sharing
 *   - https://docs.google.com/document/d/<ID>/export?format=docx
 *   - https://docs.google.com/document/d/<ID>
 *   - https://docs.google.com/document/u/0/d/<ID>/edit
 */
export function extractGoogleDocId(url: string): string {
  const match = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (!match || !match[1]) {
    throw new Error(`[google-docs] unable to extract Doc ID from: ${url}`);
  }
  return match[1];
}

/**
 * Converts any share/edit URL to the public DOCX export URL.
 */
export function googleDocsToDocxUrl(url: string): string {
  const id = extractGoogleDocId(url);
  return `https://docs.google.com/document/d/${id}/export?format=docx`;
}

/**
 * Returns a Content-Type's bare MIME type without parameters (e.g.
 * `application/octet-stream; charset=binary` -> `application/octet-stream`).
 */
function stripContentTypeParams(value: string | null): string {
  if (!value) return "";
  const semi = value.indexOf(";");
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}

/**
 * Fetches a Google-Doc as a DOCX Buffer. Cached for 5 minutes.
 *
 * Throws with a clear message if the Doc is not public (404/403). Throws on
 * other network or content-type errors as well.
 */
export async function fetchGoogleDocAsDocx(url: string): Promise<Buffer> {
  const exportUrl = googleDocsToDocxUrl(url);

  // Cache key = export URL (already canonical).
  const cached = docxCache.get(exportUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.buffer;
  }

  const res = await fetch(exportUrl, { redirect: "follow" });
  if (res.status === 404 || res.status === 403) {
    throw new Error(
      "Google Doc nicht öffentlich oder nicht gefunden. " +
        "Bitte stelle in Google Docs auf 'Jeder mit dem Link' (Leser) " +
        "und versuche es erneut.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `[google-docs] download failed: ${res.status} ${res.statusText} (${exportUrl})`,
    );
  }

  const contentType = stripContentTypeParams(res.headers.get("content-type"));
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    // Google sometimes serves an HTML login page when the doc is private but
    // returns 200 (after a redirect chain). Detect that and throw the
    // friendly "not public" message instead of saving HTML as DOCX.
    throw new Error(
      `Google Doc nicht öffentlich oder nicht gefunden (content-type=${contentType}). ` +
        "Bitte freigeben für 'Jeder mit dem Link'.",
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // Sanity-check: a real DOCX is a ZIP, so it starts with the PK\x03\x04
  // local-file-header signature.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(
      "Google Doc nicht öffentlich oder nicht gefunden (kein gültiges DOCX empfangen).",
    );
  }

  docxCache.set(exportUrl, { buffer, fetchedAt: Date.now() });
  return buffer;
}

/**
 * Converts any share/edit URL to the public HTML export URL.
 */
export function googleDocsToHtmlUrl(url: string): string {
  const id = extractGoogleDocId(url);
  return `https://docs.google.com/document/d/${id}/export?format=html`;
}

/**
 * Fetches a Google-Doc as an HTML string. Cached for 5 minutes under a
 * distinct cache key (`html:<docId>`) so it never collides with the DOCX
 * cache.
 *
 * Used by the personalized-gdocs video pipeline: the worker substitutes
 * `{{placeholders}}` directly in the exported HTML and renders the
 * personalized result in Puppeteer.
 *
 * Throws the same "doc is private" friendly error as `fetchGoogleDocAsDocx`
 * on 403/404.
 */
export async function fetchGoogleDocAsHtml(url: string): Promise<string> {
  const docId = extractGoogleDocId(url);
  const cacheKey = `html:${docId}`;
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;

  const cached = htmlCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.html;
  }

  const res = await fetch(exportUrl, { redirect: "follow" });
  if (res.status === 404 || res.status === 403) {
    throw new Error(
      "Google Doc nicht öffentlich oder nicht gefunden. " +
        "Bitte stelle in Google Docs auf 'Jeder mit dem Link' (Leser) " +
        "und versuche es erneut.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `[google-docs] html download failed: ${res.status} ${res.statusText} (${exportUrl})`,
    );
  }

  const contentType = stripContentTypeParams(res.headers.get("content-type"));
  // The export endpoint serves text/html; if Google redirected us to a login
  // page it's still text/html but the body will be the sign-in form. We
  // don't try to detect that here — the downstream Puppeteer render will
  // simply show what was returned. (For private docs the 403/404 branch
  // above catches the common case.)
  if (contentType && !contentType.startsWith("text/html")) {
    throw new Error(
      `Google Doc nicht öffentlich oder nicht gefunden (content-type=${contentType}). ` +
        "Bitte freigeben für 'Jeder mit dem Link'.",
    );
  }

  const html = await res.text();
  htmlCache.set(cacheKey, { html, fetchedAt: Date.now() });
  return html;
}

/** Test helper: drop all cached DOCX entries. */
export function _clearGoogleDocsCache(): void {
  docxCache.clear();
  htmlCache.clear();
}
