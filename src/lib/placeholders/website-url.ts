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
