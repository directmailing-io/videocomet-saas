/**
 * screenshot-error-text — übersetzt rohe Screenshot-/Vorschau-Fehler
 * (Puppeteer/Chromium-Netzwerkfehler, HTTP-Status, Worker-Meldungen) in
 * laienverständliches Deutsch.
 *
 * Regeln:
 * - Bekannte technische Muster (net::ERR_*, Timeouts, Zertifikate, HTTP
 *   403/404) bekommen eine konkrete, freundliche Erklärung.
 * - Unbekannte, aber erkennbar technische Meldungen fallen auf einen
 *   generischen Hinweis zurück.
 * - Bereits menschenlesbare (deutsche) Meldungen werden unverändert
 *   durchgereicht — so bleiben z. B. Upload- oder Worker-Hinweise erhalten.
 */

const FALLBACK_TEXT =
  "Die Webseite konnte nicht geladen werden. Prüfe die Adresse und versuche es erneut.";

/** Erkennbar technische Meldung (Chromium/Node/Puppeteer-Jargon)? */
const TECHNICAL_RE =
  /net::|err_[a-z_]+|enotfound|econnrefused|econnreset|etimedout|getaddrinfo|timeouterror|navigation timeout|protocol error|target closed|frame.*detached|browser has disconnected|execution context|evaluation failed|http \d{3}|status(?:code)? \d{3}/i;

export function friendlyScreenshotError(
  raw: string | null | undefined,
): string {
  const msg = (raw ?? "").trim();
  if (!msg) return FALLBACK_TEXT;

  if (/err_name_not_resolved|enotfound|getaddrinfo/i.test(msg)) {
    return "Diese Adresse wurde nicht gefunden. Prüfe die Schreibweise, zum Beispiel firma.de";
  }

  if (/err_cert_|err_ssl_|cert_authority|ssl protocol/i.test(msg)) {
    return "Die Webseite hat ein Sicherheitsproblem (Zertifikat). Prüfe die Adresse.";
  }

  if (
    /err_connection_refused|err_connection_timed_out|err_timed_out|err_connection_reset|err_connection_closed|err_address_unreachable|err_internet_disconnected|econnrefused|econnreset|etimedout|timeouterror|navigation timeout/i.test(
      msg,
    )
  ) {
    return "Die Webseite hat nicht geantwortet. Bitte versuche es erneut.";
  }

  if (/(?:http|status(?:code)?)[^\d]{0,3}403\b/i.test(msg)) {
    return "Die Webseite blockiert automatische Zugriffe. Versuche es erneut oder wähle eine andere Seite.";
  }

  if (/(?:http|status(?:code)?)[^\d]{0,3}404\b/i.test(msg)) {
    return "Diese Seite wurde nicht gefunden. Prüfe die Adresse.";
  }

  // Unbekannt, aber klar technisch → generischer Hinweis statt Rohtext.
  if (TECHNICAL_RE.test(msg)) return FALLBACK_TEXT;

  // Vermutlich schon eine freundliche (deutsche) Meldung.
  return msg;
}
