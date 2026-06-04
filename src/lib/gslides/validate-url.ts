/**
 * Validierung + Normalisierung von Google-Slides-Published-URLs.
 *
 * Google bietet zwei Formate für „Im Web veröffentlicht"-Decks:
 *   1. Pubembed   `https://docs.google.com/presentation/d/e/<HASH>/pubembed`
 *      (interaktives Embed mit Folien-Nav + transitions)
 *   2. Pub        `https://docs.google.com/presentation/d/e/<HASH>/pub`
 *      (Auto-Advance-Spielmodus für Slideshow-Tabs)
 *
 * Beide haben den `e` zwischen `/d/` und der Hash — das ist der entscheidende
 * Unterschied zur EDIT-URL (`/presentation/d/<DOC_ID>/edit`).
 *
 * Edit-URLs werden klar zurückgewiesen, weil Google sie ohne Login nicht
 * rendert und Puppeteer dort nur ein „Login" sieht.
 */

export type GSlidesUrlKind = "pubembed" | "pub";

export interface ParsedGSlidesUrl {
  /** Welche Variante der published URL es ist. */
  kind: GSlidesUrlKind;
  /**
   * Der publisher-Hash, der in `/d/e/<HASH>/…` steht. NICHT die docId — eine
   * published-Url verwendet einen separaten public hash, der nichts mit der
   * docId zu tun haben muss.
   */
  publisherHash: string;
  /**
   * Kanonische pubembed-URL, ohne Query-String. Wir nutzen sie als Schlüssel
   * für Bunny-Storage-Pfade etc.
   */
  canonicalPubembedUrl: string;
}

export class GSlidesUrlError extends Error {
  /**
   * Maschinen-lesbarer Code. Hilft den API-Routen, die passende HTTP-Status-
   * Code zurückzugeben (z. B. 422 für edit-url).
   */
  readonly code:
    | "edit-url"
    | "not-google"
    | "wrong-host"
    | "no-hash"
    | "empty"
    | "malformed";

  constructor(code: GSlidesUrlError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GSlidesUrlError";
  }
}

/**
 * Prüft eine User-Eingabe gegen die published-URL-Formate von Google Slides.
 *
 * Wirft `GSlidesUrlError`, wenn die URL keine published-URL ist (z. B.
 * `/edit`). Für valide URLs wird die kanonische Pubembed-URL zurückgegeben —
 * Caller können sie als Cache-Key verwenden und müssen sich nicht um
 * Query-Parameter scheren.
 */
export function parsePublishedSlidesUrl(input: string): ParsedGSlidesUrl {
  const raw = (input ?? "").trim();
  if (raw.length === 0) {
    throw new GSlidesUrlError("empty", "Bitte eine Google-Slides-URL eingeben.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GSlidesUrlError(
      "malformed",
      "Das ist keine gültige URL. Bitte den Veröffentlichungs-Link aus Google Slides hier einfügen.",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GSlidesUrlError(
      "malformed",
      "Nur http(s)-URLs werden unterstützt.",
    );
  }

  // Host: erlaubt sind `docs.google.com` ODER `www.docs.google.com`.
  const host = url.hostname.toLowerCase();
  if (host !== "docs.google.com" && host !== "www.docs.google.com") {
    throw new GSlidesUrlError(
      "not-google",
      "Bitte einen Link aus Google Slides verwenden (docs.google.com).",
    );
  }

  // Path: `/presentation/d/e/<HASH>/(pubembed|pub)` ist published.
  // Path: `/presentation/d/<DOC_ID>/edit` ist EDIT — explizit ablehnen.
  const path = url.pathname.replace(/\/+$/, "");

  // Wir matchen die Edit-URL ZUERST — sonst würde der Pubembed-Regex
  // mit lazyem `[^/]+` versehentlich greifen.
  const editMatch = path.match(
    /^\/presentation\/d\/(?!e\/)([a-zA-Z0-9_-]+)\/(edit|view|present|preview|copy|template)$/,
  );
  if (editMatch) {
    throw new GSlidesUrlError(
      "edit-url",
      'Das ist die Bearbeiten-URL deiner Präsentation. Bitte in Google Slides auf „Datei → Im Web veröffentlichen" klicken und den dort angezeigten Link verwenden.',
    );
  }

  const pubMatch = path.match(
    /^\/presentation\/d\/e\/([a-zA-Z0-9_-]+)\/(pubembed|pub|embed)$/,
  );
  if (!pubMatch) {
    throw new GSlidesUrlError(
      "no-hash",
      "Die URL sieht nicht nach einem veröffentlichten Google-Slides-Deck aus. Erwartet wird ein Link auf docs.google.com/presentation/d/e/.../pubembed.",
    );
  }
  const publisherHash = pubMatch[1];
  // `embed` ist ein Alias für `pubembed` — beides matched, beide werden
  // als pubembed behandelt.
  const rawKind = pubMatch[2];
  const kind: GSlidesUrlKind = rawKind === "pub" ? "pub" : "pubembed";

  const canonicalPubembedUrl = `https://docs.google.com/presentation/d/e/${publisherHash}/pubembed`;

  return { kind, publisherHash, canonicalPubembedUrl };
}

/**
 * Schnelle Boolean-Variante. Niemals werfend.
 */
export function isPublishedSlidesUrl(input: string): boolean {
  try {
    parsePublishedSlidesUrl(input);
    return true;
  } catch {
    return false;
  }
}
