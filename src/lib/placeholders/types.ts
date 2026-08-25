/**
 * Zentrale Typen für das einheitliche Platzhalter-Mapping.
 *
 * Konsolidiert frühere verstreute Substitutionen (5+ Stellen, 3 Formate)
 * auf einen gemeinsamen Vertrag. Konzept-Hintergrund siehe
 * `/public/konzept-placeholder-mapping.html` (legacy repo).
 *
 * Endpoints, die diese Typen serialisieren:
 *   GET /api/runs/[id]/placeholders → { placeholders, csvColumns,
 *                                       suggestedMapping }
 *   PUT /api/runs/[id]/mapping       Body: { placeholderMapping }
 */

/** Kind der Quelle, in der ein Platzhalter im Asset entdeckt wurde. */
export type PlaceholderSourceKind =
  | "slide" // SlideSegment → TextLayer Tiptap-HTML
  | "text" // TextSegment.text
  | "gdocs" // Google-Doc-Brief / Segment
  | "gslide" // Google-Slides-Folie (kind: "gslide")
  | "canva" // Canva-Folie (kind: "canva", PPTX-Upload)
  | "pdf" // PDF-Brief der Kampagne (= campaigns.pdfGoogleDocsUrl)
  | "lp-block" // Block-Landingpage-Template
  | "lp-custom" // Custom-HTML-LP (ZIP-Upload)
  | "envelope" // Umschlag-Vorlage (envelope_templates)
  | "slug" // Slug-Template `{key}`
  | "website" // Website-Segment (Lead-URL-Spalte für Scroll-/Hero-Capture)
  | "email"; // E-Mail-Vorlage (email_templates, Runden-Option „benachrichtigen")

/** Quellen-Eintrag pro Detected-Placeholder (mehrere möglich). */
export interface PlaceholderSource {
  /** Welcher Asset-Typ den Key enthält. */
  kind: PlaceholderSourceKind;
  /** Menschen-lesbares Label, z. B. „Folie 3", „PDF-Brief", „Block: Hero". */
  label: string;
  /**
   * Wenn `true`, konnte das Asset nicht statisch gelesen werden
   * (z. B. Google Doc ohne Zugriff). Die UI zeigt dann eine Warn-Pille
   * „Doc nicht lesbar".
   */
  inaccessible?: boolean;
}

/** Ein im Campaign-Scan gefundener Platzhalter mit Original-Key + Quellen. */
export interface DetectedPlaceholder {
  /** Originale Schreibweise (case-sensitive), wie im Asset gefunden. */
  key: string;
  /**
   * Lowercase + Umlaute-replaced + Separatoren entfernt — für Auto-Match
   * gegen normalisierte CSV-Spaltennamen.
   */
  normalized: string;
  /** Quellen, in denen dieser Key vorkommt (mind. eine). */
  sources: PlaceholderSource[];
  /** Anzahl Vorkommen über alle Quellen. */
  occurrences: number;
}

/** Operator einer Wenn-Dann-Regel. */
export type PlaceholderRuleOp = "equals" | "is_empty";

/**
 * Wenn-Dann-Regel pro Mapping-Eintrag. Transformiert den aus der CSV-
 * Spalte gelesenen Rohwert BEVOR Fallbacks greifen:
 *
 *   - `equals`:   matcht tolerant (trim, case-insensitive, Whitespace-
 *                 Collapse, Unicode-NFC) gegen `match`.
 *   - `is_empty`: greift, wenn die Zelle leer/nur Whitespace ist.
 *
 * Semantik: erste zutreffende Regel gewinnt; der Output triggert KEINE
 * weitere Regel (keine Ketten). Trifft keine Regel, bleibt der Rohwert.
 */
export interface PlaceholderRule {
  op: PlaceholderRuleOp;
  /** Vergleichswert — nur bei `equals` relevant. */
  match?: string;
  /** Ersatzwert bei Treffer. Leerer String ⇒ Wert wird geleert (Fallback greift danach). */
  output: string;
}

/** Ein Mapping-Eintrag pro Platzhalter (Spalte + optionaler Fallback). */
export interface PlaceholderMappingEntry {
  /** CSV-Spaltenname; `undefined` ⇒ keine Spalte zugewiesen. */
  column?: string;
  /** Wert, der eingesetzt wird, wenn die CSV-Zelle leer ist. */
  fallback?: string;
  /**
   * Explizite User-Entscheidung „leer lassen": der Platzhalter rendert leer,
   * ohne dass Spalte oder Fallback nötig sind. Muss persistiert werden —
   * `column: undefined` allein überlebt JSON.stringify nicht und wäre vom
   * Zustand „noch nicht zugewiesen" nicht unterscheidbar.
   */
  empty?: boolean;
  /** Wenn-Dann-Regeln, angewandt auf den Spaltenwert (siehe PlaceholderRule). */
  rules?: PlaceholderRule[];
}

/**
 * Mapping pro Lauf: many-to-one — mehrere Keys dürfen dieselbe Spalte zeigen.
 * Wird im DB-Feld `runs.column_mapping.placeholderMapping` persistiert
 * (parallel zum Legacy-`mapping` während der Migration).
 */
export type PlaceholderMapping = Record<string, PlaceholderMappingEntry>;

/**
 * Token-Format-Hint für `substitute()`. Bestimmt welche Regex angewendet wird.
 *
 * - `double-brace`           `{{ key }}`            (Text-Segmente, Slide-{{}}-Fallback)
 * - `double-brace-fallback`  `{{ key | fallback }}` (Block-LP, Custom-LP, gdocs)
 * - `tiptap-span`            `<span data-placeholder="key" data-fallback="…">{{key}}</span>`
 * - `single-brace`           `{ key }`              (Slug-Template)
 */
export type PlaceholderFormat =
  | "double-brace"
  | "double-brace-fallback"
  | "tiptap-span"
  | "single-brace";

/**
 * Legacy-Format wie es früher in `runs.column_mapping.mapping` lag.
 * Wir halten den Typ exportiert, weil `resolveMapping()` ihn aufs neue
 * Format hebt.
 */
export type LegacyMapping = Record<string, string>;

/**
 * Form des persisted `runs.column_mapping`-Blobs. Beide Mapping-Felder
 * optional — der Collector kann auf Runs treffen, die NIE durch den neuen
 * Wizard liefen.
 */
export interface StoredRunColumnMapping {
  parsed?: {
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
    source?: "xlsx" | "csv" | "google-sheets";
    encoding?: string;
    delimiter?: string;
  };
  /** Altes Format. key === column (Record<string,string>). */
  mapping?: LegacyMapping;
  /** Neues Format mit Fallback + Many-to-one. */
  placeholderMapping?: PlaceholderMapping;
}

/**
 * Response des GET-Endpoints, der die Mapping-Stage füttert.
 * Liefert gefundene Platzhalter, CSV-Spalten, und ggf. ein vor-belegtes
 * Mapping (aus letzter Runde oder Auto-Suggest).
 */
export interface RunPlaceholdersResponse {
  placeholders: DetectedPlaceholder[];
  csvColumns: string[];
  /**
   * Vom Server vorgeschlagenes Mapping; greift Reuse aus letzter Runde
   * sowie Normalisierungs-/Alias-basierte Vorschläge. Keys decken nicht
   * notwendigerweise alle `placeholders` ab.
   */
  suggestedMapping: PlaceholderMapping;
  /**
   * Optional: Wenn der Server schon eingestellte Werte aus einer früheren
   * Runde übernommen hat, ist dieses Flag `true` — die UI zeigt dann ein
   * „Aus voriger Runde übernommen"-Banner.
   */
  reusedFromPreviousRun?: boolean;
  /**
   * Anzahl nicht-leerer Zellen pro CSV-Spalte. Die UI warnt, wenn eine
   * gemappte Spalte komplett leer ist (Wert 0) — sonst tappt der User in
   * die „alle Leads aussortiert"-Falle erst beim Start.
   */
  columnFillCounts?: Record<string, number>;
  /** Gesamtzahl der Rows in der hochgeladenen Liste. */
  rowCount?: number;
}
