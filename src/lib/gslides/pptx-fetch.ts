/**
 * PPTX-Download für Edit-Mode-URLs.
 *
 * Google bietet für jede „Anyone with link" geteilte Präsentation einen
 * Export-Endpoint:
 *
 *   https://docs.google.com/presentation/d/<DOC_ID>/export/pptx
 *
 * Der Endpoint:
 *   - liefert ein vollständiges .pptx (ZIP + XML) zurück
 *   - antwortet mit 200 + Body, wenn das Deck mit Anyone-with-link geteilt
 *     ist (Login wird per Cookie nicht erzwungen)
 *   - antwortet mit 404, wenn das Deck NICHT geteilt ist (oder die ID
 *     falsch ist) — Google liefert dann eine HTML-Login-Seite + 404
 *   - antwortet mit 401/403 in Edge-Cases (z. B. Domain-restricted-Sharing)
 *
 * Wir wickeln das defensiv ab und werfen mit Code `"not-shared"`, damit
 * der Caller dem User eine klare Anweisung geben kann („teile auf
 * Anyone-with-link").
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * User-Agent-String. Google sniffed in der Vergangenheit bestimmte Bots ab
 * und antwortet dann mit einer „Bitte einloggen"-Seite. Ein normaler
 * Browser-UA umgeht das zuverlässig.
 */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Fehler-Codes der `downloadPptx`-Funktion.
 *
 *   - `not-shared`     Deck ist nicht öffentlich geteilt (404/401/403).
 *   - `not-pptx`       Response ist kein PPTX (z. B. HTML-Login-Seite mit 200).
 *   - `network`        Network-Fehler oder Timeout.
 *   - `too-large`      Response > 100 MB; wir wollen keine Bombs.
 */
export class PptxDownloadError extends Error {
  readonly code: "not-shared" | "not-pptx" | "network" | "too-large";
  constructor(
    code: PptxDownloadError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PptxDownloadError";
  }
}

const MAX_PPTX_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Lädt das PPTX einer Präsentation als Buffer. Niemals retry — die
 * Strategie ist „fail fast, Caller entscheidet".
 *
 * Wir prüfen zwei Dinge nach dem Fetch, weil Google bei nicht-geteilten
 * Decks NICHT immer 404 liefert:
 *
 *   1. Status muss 200 sein.
 *   2. Der Body muss tatsächlich ein ZIP sein (Magic-Number `PK\x03\x04`).
 *      Eine HTML-Login-Seite würde sonst durch unseren Filter rutschen.
 */
export async function downloadPptx(docId: string): Promise<Buffer> {
  if (!docId || !/^[a-zA-Z0-9_-]{25,}$/.test(docId)) {
    throw new PptxDownloadError(
      "network",
      `Ungültige docId: ${docId}`,
    );
  }

  const url = `https://docs.google.com/presentation/d/${docId}/export/pptx`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation,*/*",
        // Wichtig: KEINE Cookies. Wir wollen den anonymen Zugriffspfad.
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new PptxDownloadError(
      "network",
      `PPTX-Download fehlgeschlagen: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new PptxDownloadError(
      "not-shared",
      "Google liefert das Deck nicht als PPTX. Bitte die Präsentation auf „Jede Person mit dem Link“ freigeben.",
    );
  }
  if (response.status !== 200) {
    throw new PptxDownloadError(
      "network",
      `Unerwarteter HTTP-Status vom PPTX-Export: ${response.status}`,
    );
  }

  // Body streamen, aber mit Hard-Cap.
  const arrayBuf = await response.arrayBuffer();
  if (arrayBuf.byteLength > MAX_PPTX_BYTES) {
    throw new PptxDownloadError(
      "too-large",
      `PPTX zu groß (${arrayBuf.byteLength} Byte). Limit: ${MAX_PPTX_BYTES} Byte.`,
    );
  }
  const buf = Buffer.from(arrayBuf);

  // Magic-Number check: alle ZIP-Dateien starten mit "PK\x03\x04" oder
  // "PK\x05\x06" (Empty-Archive). PPTX ist immer ein vollwertiges ZIP.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new PptxDownloadError(
      "not-pptx",
      "Antwort ist kein PPTX-Archiv — vermutlich liefert Google eine HTML-Login-Seite. Bitte Freigabe auf „Jede Person mit dem Link“ prüfen.",
    );
  }

  return buf;
}
