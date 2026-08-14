import type { WebsiteSegment } from "@/lib/segments/types";

/**
 * Mapping-Key, unter dem die Lead-Website eines Website-Segments im
 * Run-Platzhalter-Mapping geführt wird, wenn im Kampagnen-Editor keine
 * Spalte fest hinterlegt wurde. Die Spalten-Zuweisung passiert dann erst
 * im Mapping-Schritt des Run-Wizards.
 */
export const DEFAULT_WEBSITE_URL_KEY = "website";

/**
 * Effektiver Mapping-Key eines Website-Segments. Legacy-Kampagnen mit
 * gesetztem `urlColumn` behalten ihren Key (Auto-Suggest matcht die
 * gleichnamige CSV-Spalte → Verhalten unverändert); neue Segmente ohne
 * Spalte laufen unter `DEFAULT_WEBSITE_URL_KEY`.
 */
export function websiteSegmentMappingKey(
  seg: Pick<WebsiteSegment, "urlColumn">,
): string {
  return seg.urlColumn?.trim() || DEFAULT_WEBSITE_URL_KEY;
}

/**
 * Leitet aus einem vom Nutzer eingegebenen Seiten-Namen (z. B.
 * „Karriereseite") einen Mapping-Key/`urlColumn`-Slug ab: lowercase,
 * Umlaute transliteriert, alles Nicht-Alphanumerische zu Bindestrichen.
 * Leerer Rückgabewert = kein brauchbarer Name.
 */
export function slugifyUrlColumn(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
