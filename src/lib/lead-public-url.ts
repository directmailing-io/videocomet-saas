/**
 * Zentraler URL-Builder fuer Lead-Landingpages.
 *
 * Eine Quelle der Wahrheit, damit alle internen + externen Links
 * konsistent die richtige URL haben — Custom-Domain wenn die Kampagne
 * eine aktive hat, sonst Default app.videocomet.de.
 *
 * Aufrufer aus allen Bereichen: live-table, analytics, exports,
 * Mail-Templates, Worker (landingpage-create).
 */

export interface BuildLeadUrlInput {
  slug: string | null | undefined;
  /** Hostname der Custom-Domain — NULL fuer Default-App. */
  customHostname?: string | null;
  /** Default-App-URL ohne Trailing-Slash, z.B. `https://app.videocomet.de`. */
  defaultAppUrl?: string;
}

export interface BuildLeadUrlOptions {
  /** ?preview=1 anhaengen — fuer interne Vorschau-Links. */
  preview?: boolean;
  /**
   * Erzwingt absolute URL (mit https://). Default: nur bei
   * Custom-Hostname absolute, bei Default-App relativer Pfad. Setze
   * `true` fuer Export-CSVs/Mail wo absolute Links Pflicht sind.
   */
  absolute?: boolean;
}

const DEFAULT_APP = "https://app.videocomet.de";

/**
 * Liefert die oeffentliche Landing-URL fuer einen Lead.
 *
 *   - Custom-Domain aktiv  → `https://video.kunde.de/<slug>`
 *   - Default              → `/v/<slug>` (relativ) oder absolut wenn gewuenscht
 *
 * Returnt NULL nur wenn weder slug noch hostname auswertbar sind.
 */
export function buildLeadPublicUrl(
  input: BuildLeadUrlInput,
  options: BuildLeadUrlOptions = {},
): string | null {
  const slug = (input.slug ?? "").trim();
  if (!slug) return null;
  const host = (input.customHostname ?? "").trim().toLowerCase();
  const appUrl = (input.defaultAppUrl ?? DEFAULT_APP).replace(/\/+$/, "");
  const previewSuffix = options.preview ? "?preview=1" : "";

  if (host) {
    return `https://${host}/${slug}${previewSuffix}`;
  }
  if (options.absolute) {
    return `${appUrl}/v/${slug}${previewSuffix}`;
  }
  return `/v/${slug}${previewSuffix}`;
}
