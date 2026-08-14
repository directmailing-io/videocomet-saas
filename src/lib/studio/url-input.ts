/**
 * url-input — Normalisierung + Laien-Validierung für URL-Eingaben im
 * Studio (Regie-Phase). Verhindert, dass unvollständige Eingaben wie
 * „videocomet" als https://videocomet/ an den Screenshot-Worker gehen und
 * dort mit net::ERR_NAME_NOT_RESOLVED scheitern.
 */

/** https:// voranstellen, wenn kein Protokoll angegeben ist. */
export function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const URL_INPUT_HINT =
  "Bitte gib eine vollständige Adresse ein, zum Beispiel firma.de";

/**
 * Prüft eine URL-Eingabe vor dem Screenshot-Start. Liefert `null`, wenn
 * alles gut aussieht, sonst einen freundlichen Hinweistext: Die Adresse
 * muss parsebar sein und der Host braucht einen Punkt plus Endung
 * (mindestens 2 Buchstaben, z. B. „.de").
 */
export function urlInputError(raw: string): string | null {
  const normalized = normalizeUrlInput(raw);
  if (!normalized) return URL_INPUT_HINT;
  let host: string;
  try {
    host = new URL(normalized).hostname;
  } catch {
    return URL_INPUT_HINT;
  }
  const cleaned = host.replace(/\.$/, "");
  if (!/\.[a-z]{2,}$/i.test(cleaned)) return URL_INPUT_HINT;
  return null;
}
