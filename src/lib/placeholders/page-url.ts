/**
 * Page-URL-Helper für den globalen `{{pageUrl}}`-Platzhalter (Paket A,
 * Thumbnail-Generator). Liefert die abtippbare Kurzform der Lead-
 * Landingpage-URL — ohne Protokoll, ohne Trailing-Slash:
 *
 *   "video.digispace.at/simon-krempel"     (Custom-Domain)
 *   "app.videocomet.de/v/simon-krempel"    (Default-Domain)
 *
 * Die Kurzform wird im PDF-Brief und im Thumbnail eingedruckt — sie ist
 * darauf optimiert, vom Empfänger händisch in einen Browser eintippbar zu
 * sein (kein "https://", keine Slashes am Ende).
 *
 * Diese Funktion ist intentional pur — sie greift NICHT auf die DB zu;
 * die Pipeline löst Domain + Slug pro Lead auf und ruft `buildPageUrlShort`
 * mit fertig aufgelösten Strings auf.
 */

/**
 * Entfernt `http://` oder `https://`-Präfixe und einen optionalen Trailing-
 * Slash. Defensiv gegen leere/ungueltige Inputs.
 */
function stripProtocol(input: string): string {
  if (!input || typeof input !== "string") return "";
  let s = input.trim();
  if (s === "") return "";
  s = s.replace(/^https?:\/\//i, "");
  // Trailing-Slash(es) entfernen — aber keine Slashes im Pfad mitten drin.
  s = s.replace(/\/+$/g, "");
  return s;
}

/**
 * Normalisiert einen Hostname (lowercase, Trim, optional Protokoll-Präfix
 * abschneiden — falls Aufrufer versehentlich eine volle URL übergibt).
 */
function normalizeHostname(host: string | null | undefined): string {
  if (!host) return "";
  const stripped = stripProtocol(host).toLowerCase();
  return stripped;
}

/**
 * Normalisiert einen Slug — minimal defensiv (Trim + Leading/Trailing-
 * Slash entfernt). Wir mutieren den Slug NICHT weiter (kein slugify), weil
 * der Caller bereits einen DB-validierten Slug übergibt.
 */
function normalizeSlug(slug: string | null | undefined): string {
  if (!slug) return "";
  return String(slug).trim().replace(/^\/+|\/+$/g, "");
}

/**
 * Baut die Lead-Page-URL in Kurzform (ohne Protokoll, ohne Trailing-Slash).
 *
 * @param domainHostname  Hostname der Custom-Domain (z.B. "video.digispace.at").
 *                        `null`/leer ⇒ Default-Domain (App-URL aus env).
 * @param slug            Lead-Slug (z.B. "simon-krempel"). Leer ⇒ Funktion
 *                        liefert die nackte Domain ohne Slug-Pfad — der
 *                        Caller sollte das eigentlich verhindern, aber wir
 *                        crashen nicht.
 * @param defaultAppUrl   Volle App-URL aus env (z.B. "https://app.videocomet.de").
 *                        Wird auf Hostname reduziert und mit "/v/<slug>"
 *                        ergänzt, wenn `domainHostname` leer ist.
 *
 * Beispiele:
 *   buildPageUrlShort("video.digispace.at", "simon-krempel", "https://app.videocomet.de")
 *     → "video.digispace.at/simon-krempel"
 *
 *   buildPageUrlShort(null, "simon-krempel", "https://app.videocomet.de")
 *     → "app.videocomet.de/v/simon-krempel"
 *
 *   buildPageUrlShort("", "anna-meier", "https://app.videocomet.de/")
 *     → "app.videocomet.de/v/anna-meier"
 *
 *   buildPageUrlShort("VIDEO.DIGISPACE.AT/", "  peter  ", "app.videocomet.de")
 *     → "video.digispace.at/peter"
 */
export function buildPageUrlShort(
  domainHostname: string | null,
  slug: string,
  defaultAppUrl: string,
): string {
  const cleanSlug = normalizeSlug(slug);
  const cleanHost = normalizeHostname(domainHostname);

  if (cleanHost) {
    // Custom-Domain: <hostname>/<slug>
    return cleanSlug ? `${cleanHost}/${cleanSlug}` : cleanHost;
  }

  // Default: stripProtocol(defaultAppUrl)/v/<slug>
  const fallbackHost = stripProtocol(defaultAppUrl || "");
  if (!fallbackHost) {
    // Worst-Case: weder Domain noch env → wir liefern wenigstens den Slug.
    return cleanSlug ? `/v/${cleanSlug}` : "";
  }
  return cleanSlug ? `${fallbackHost}/v/${cleanSlug}` : fallbackHost;
}
