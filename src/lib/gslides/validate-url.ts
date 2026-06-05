/**
 * Validierung + Normalisierung von Google-Slides-URLs.
 *
 * Zwei Modi werden akzeptiert:
 *
 *   1. „edit"  (NEU, bevorzugt)
 *      Edit-/View-/Preview-URL einer mit „Anyone with link" geteilten
 *      Präsentation. Wir extrahieren die `docId` und nutzen den
 *      PPTX-Export-Endpoint `/d/<docId>/export/pptx` als kanonische Quelle.
 *      Diese Variante erlaubt Substitution im XML, weil wir das Deck
 *      vollständig herunterladen können.
 *
 *   2. „pubembed"  (Legacy)
 *      Bestehende „Im Web veröffentlichen"-URLs (`/d/e/<HASH>/pubembed`
 *      oder `/d/e/<HASH>/pub`). Bleiben akzeptiert für Bestandskampagnen,
 *      sind aber als „deprecated" markiert: Substitution funktioniert NUR
 *      auf DOM-Ebene und ist fragil. Wir wollen diese Variante mittelfristig
 *      abschalten.
 *
 * Der entscheidende Unterschied im Pfad: Pubembed enthält `/d/e/<HASH>/…`
 * (mit dem `e/` als separatem Pfad-Segment), eine Edit-URL enthält
 * `/d/<DOC_ID>/…` (ohne `e/` davor). Wir matchen die Edit-Variante zuerst
 * mit einem Negative-Lookahead `(?!e\/)`, sonst würde der Pubembed-Regex
 * auch eine Edit-URL halbwegs greifen.
 */

export type GSlidesUrlMode = "edit" | "pubembed";

/**
 * Legacy-Typname für Kompatibilität mit bestehendem Code.
 * Wir mappen die alten Werte (`"pubembed" | "pub"`) auf den Modus
 * `"pubembed"` und exportieren beides.
 */
export type GSlidesUrlKind = "pubembed" | "pub";

/**
 * Edit-Modus: User hat eine Anyone-with-link-URL geteilt. Wir laden das
 * Deck via PPTX-Export, parsen es selber und können Platzhalter im XML
 * 1:1 ersetzen.
 */
export interface ParsedGSlidesEdit {
  mode: "edit";
  /** Die Google-Document-ID (in der URL zwischen `/d/` und `/edit`). */
  docId: string;
  /** Kanonische PPTX-Export-URL — Cache-Key + Quelle für `downloadPptx`. */
  canonicalExportUrl: string;
}

/**
 * Pubembed-Modus: Legacy-Pub-/Pubembed-URLs. Halten wir am Leben für
 * Bestandskampagnen, aber Substitution wird hier NICHT mehr ausgeführt.
 */
export interface ParsedGSlidesPubembed {
  mode: "pubembed";
  /** Der publisher-Hash, der in `/d/e/<HASH>/…` steht. */
  publisherHash: string;
  /** Kanonische pubembed-URL ohne Query-String. */
  canonicalPubembedUrl: string;
  /** Subform — pubembed-Iframe vs. Auto-Advance-Spielmodus. */
  kind: GSlidesUrlKind;
}

export type ParsedGSlidesUrl = ParsedGSlidesEdit | ParsedGSlidesPubembed;

export class GSlidesUrlError extends Error {
  /**
   * Maschinen-lesbarer Code. Hilft den API-Routen, die passende HTTP-Status-
   * Code zurückzugeben.
   *
   * `edit-url` ist mit dem Pivot auf PPTX-Export NICHT mehr ein Fehler —
   * wir behalten den Code dennoch, weil bestehende API-Routen ihn auf 422
   * mappen und der Code für „nicht-published, aber nicht-bekannt"
   * gebraucht wird.
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
 * Prüft eine User-Eingabe und liefert entweder ein Edit-Mode-Result oder
 * ein Pubembed-Mode-Result.
 *
 * Wirft `GSlidesUrlError`, wenn die URL weder das eine noch das andere
 * Format hat (kaputt, falscher Host, leer).
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
      "Das ist keine gültige URL. Bitte den Link aus Google Slides hier einfügen.",
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

  const path = url.pathname.replace(/\/+$/, "");

  // 1) Edit-/View-/Preview-URL (NEU, bevorzugt). Negative-Lookahead `(?!e\/)`
  //    schützt davor, dass wir die `e`-Position einer Pubembed-URL als
  //    docId interpretieren. Akzeptierte Sub-Pfade:
  //      /edit
  //      /edit?usp=sharing
  //      /view
  //      /preview
  //      /present
  //      /copy
  //      /template/preview
  //    Wir wollen auch Edit-URLs ohne expliziten Suffix akzeptieren — also
  //    `/d/<docId>` (ohne folgenden Sub-Path) wäre theoretisch denkbar,
  //    geben Google teilen die aber nie aus. Wir bleiben strict und
  //    verlangen einen bekannten Suffix.
  //
  //    docId-Constraint: alphanumerisch + `-_`, mind. 25 Zeichen. Echte
  //    Google-IDs sind 44 Zeichen lang, kürzere Tokens stammen aus E-Mail-
  //    Disclaimer-Links und sind keine echten Decks.
  const editMatch = path.match(
    /^\/presentation\/d\/(?!e\/)([a-zA-Z0-9_-]{25,})(?:\/(?:edit|view|preview|present|copy|template(?:\/preview)?))?$/,
  );
  if (editMatch) {
    const docId = editMatch[1];
    return {
      mode: "edit",
      docId,
      canonicalExportUrl: `https://docs.google.com/presentation/d/${docId}/export/pptx`,
    };
  }

  // 2) Pubembed-/Pub-URL (Legacy). `embed` ist Alias für `pubembed`.
  const pubMatch = path.match(
    /^\/presentation\/d\/e\/([a-zA-Z0-9_-]+)\/(pubembed|pub|embed)$/,
  );
  if (pubMatch) {
    const publisherHash = pubMatch[1];
    const rawKind = pubMatch[2];
    const kind: GSlidesUrlKind = rawKind === "pub" ? "pub" : "pubembed";
    const canonicalPubembedUrl = `https://docs.google.com/presentation/d/e/${publisherHash}/pubembed`;
    return {
      mode: "pubembed",
      publisherHash,
      canonicalPubembedUrl,
      kind,
    };
  }

  // 3) Nichts passt → werfen.
  throw new GSlidesUrlError(
    "no-hash",
    "Die URL sieht weder nach einer geteilten Bearbeiten-URL noch nach einem veröffentlichten Deck aus. Erwartet wird ein Link wie docs.google.com/presentation/d/<ID>/edit.",
  );
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

/**
 * Type-Guard für Edit-Mode-Results. Caller benutzen das in
 * Substitutions-Pipelines.
 */
export function isEditMode(p: ParsedGSlidesUrl): p is ParsedGSlidesEdit {
  return p.mode === "edit";
}

/**
 * Type-Guard für Legacy-Pubembed-Results. Caller benutzen das, um die
 * Warn-Banner-Logik im UI zu triggern.
 */
export function isPubembedMode(
  p: ParsedGSlidesUrl,
): p is ParsedGSlidesPubembed {
  return p.mode === "pubembed";
}
