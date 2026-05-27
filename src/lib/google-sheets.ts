/**
 * Google-Sheets helpers used by the run-upload flow.
 *
 *  - `googleSheetsToCsvUrl` extracts the sheet ID (and optional `gid`) from a
 *    `docs.google.com/spreadsheets/d/{ID}/edit?gid={gid}` URL and returns the
 *    matching CSV-export URL.
 *  - `fetchGoogleSheetCsv` fetches that URL and returns the raw buffer (so the
 *    caller can feed it through `parseCSV`).
 */

const SHEET_ID_RE =
  /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/[^?#]*)?(?:[?#].*)?$/i;

function extractGid(url: string): string | null {
  // gid may appear in the search-string or fragment.
  const m = url.match(/[?#&]gid=(\d+)/);
  return m ? m[1] : null;
}

/**
 * Converts a "view" URL into a public CSV-export URL.
 * Throws on inputs that don't look like a Google Sheets URL.
 */
export function googleSheetsToCsvUrl(url: string): string {
  const trimmed = url.trim();
  const match = trimmed.match(SHEET_ID_RE);
  if (!match) {
    throw new Error("Keine gültige Google-Sheets-URL.");
  }
  const sheetId = match[1];
  const gid = extractGid(trimmed);
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

/**
 * Fetches a Google-Sheet as CSV.
 *
 * Requires the sheet to be shared "Anyone with the link" (which Google
 * redirects to the CSV export endpoint). If the sheet is private, Google
 * returns a 401/302 to login.html and we surface that as an error.
 */
export async function fetchGoogleSheetCsv(url: string): Promise<Buffer> {
  const csvUrl = googleSheetsToCsvUrl(url);
  const res = await fetch(csvUrl, {
    redirect: "follow",
    headers: {
      // Avoid being interpreted as a browser session preview.
      Accept: "text/csv,text/plain;q=0.9,*/*;q=0.1",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Sheet konnte nicht geladen werden (HTTP ${res.status}). Bitte stelle sicher, dass die Datei öffentlich ist.`,
    );
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    // Google's login page comes back as HTML.
    throw new Error(
      "Sheet ist nicht öffentlich. Bitte Teilen-Einstellung auf 'Jeder mit Link' setzen.",
    );
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
