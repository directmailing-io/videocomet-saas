/**
 * Bunny-Stream HLS → progressive MP4 Fallback-Helper.
 *
 * Hintergrund
 * -----------
 * Bunny Stream rendert pro Quellvideo nur die Resolutionen, die Sinn ergeben.
 * Ein 404×720-Portrait-Video bekommt z.B. nur 240p/360p/480p — ein hardcoded
 * `play_720p.mp4` liefert dann 404 fuer Portrait-Quellen.
 *
 * Dieser Helper bündelt die früher 4-fach duplizierte Replace-Heuristik
 * (`media-card.tsx`, `media/[id]/frame`, `webcam-monitor.tsx`, `custom-lp-
 * public.ts`) an EINER Stelle und nutzt — wenn vorhanden — die real
 * verfügbaren Bunny-Resolutionen.
 *
 * Public Interface
 * ----------------
 *   pickBunnyMp4Fallback(hlsUrl, availableResolutions?)
 *     → wenn availableResolutions bekannt → höchste Auflösung wählen
 *     → wenn null/leer aber Stream-URL → play_480p.mp4 (safer Default als 720p)
 *     → wenn die URL kein Bunny-HLS-Pattern matched → return unchanged
 *
 * TODO (Lint)
 * -----------
 * Eine ESLint-Rule, die Literals wie `play_720p.mp4` / `playlist.m3u8`-
 * Replace-Heuristiken in `src/` außerhalb dieses Moduls verbietet, würde
 * verhindern dass künftige Stellen wieder am Helper vorbeigreifen. Aktuell
 * deferred (Setup-Aufwand > Nutzen für 5 Stellen).
 */

/** Erlaubte Auflösungs-Labels, sortiert nach Höhe (für Vergleich). */
const RES_RANK: Record<string, number> = {
  "240p": 240,
  "360p": 360,
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};

/**
 * Matched Bunny-Stream-HLS-URLs der Form
 *   https://<cdnHost>/<guid>/playlist.m3u8[?query]
 * mit guid = 36-char UUID (8-4-4-4-12, hex).
 */
const BUNNY_HLS_PATTERN =
  /^(https?:\/\/[^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8(\?.*)?$/i;

/**
 * Sicherer Default, wenn die Resolutions-Liste fehlt: 480p existiert
 * für JEDES Bunny-Stream-Video (Mindest-Encoding-Stufe), auch für sehr
 * kleine Portrait-Quellen — anders als 720p.
 */
const SAFE_DEFAULT_RESOLUTION = "480p";

/**
 * Liefert die beste MP4-URL für ein Bunny-Stream-HLS-Asset.
 *
 * @param hlsUrl Die Quell-URL (üblicherweise `.../playlist.m3u8`).
 * @param availableResolutions Optional: Liste der real auf Bunny gerenderten
 *   Resolutions-Labels ("240p", "480p", "1080p", …). Wenn vorhanden, wird
 *   die höchste daraus gewählt.
 *
 * @returns
 *   - Bunny-HLS-URL + availableResolutions gesetzt → `.../play_<max>.mp4`
 *   - Bunny-HLS-URL + keine Resolutions          → `.../play_480p.mp4`
 *   - Non-Bunny-URL (extern, bereits MP4, …)     → unverändert
 *
 * Query-Parameter (Signed-URL-Token etc.) werden bei Bunny-HLS-Matches
 * mitgenommen.
 */
export function pickBunnyMp4Fallback(
  hlsUrl: string,
  availableResolutions?: ReadonlyArray<string> | null,
): string {
  if (!hlsUrl) return hlsUrl;
  const match = hlsUrl.match(BUNNY_HLS_PATTERN);
  if (!match) {
    // Bestandsschutz: nicht-Bunny-URLs (externe Hostings, bereits MP4, …)
    // unverändert durchreichen.
    return hlsUrl;
  }
  const [, base, guid, query = ""] = match;

  const picked = pickBestResolution(availableResolutions);
  return `${base}/${guid}/play_${picked}.mp4${query}`;
}

/**
 * Wählt die höchste valide Resolution aus dem Bunny-availableResolutions-
 * Array. Fallback `SAFE_DEFAULT_RESOLUTION` wenn nichts brauchbares dabei
 * ist.
 */
function pickBestResolution(
  resolutions?: ReadonlyArray<string> | null,
): string {
  if (!resolutions || resolutions.length === 0) {
    return SAFE_DEFAULT_RESOLUTION;
  }
  const valid = resolutions
    .map((r) => r.trim().toLowerCase())
    .filter((r) => RES_RANK[r] !== undefined);
  if (valid.length === 0) return SAFE_DEFAULT_RESOLUTION;
  valid.sort((a, b) => (RES_RANK[b] ?? 0) - (RES_RANK[a] ?? 0));
  return valid[0];
}
