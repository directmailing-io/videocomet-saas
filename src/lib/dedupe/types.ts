/**
 * Public Types der Duplikat-Erkennung (Paket A).
 *
 * Pure Daten-Strukturen — keine DB-/UI-Bindings.
 * `DedupeConfig` wird i. d. R. JSONB-persistiert; `DedupeResult` ist
 * In-Memory-only und enthält `Set` / `Map` für O(1)-Lookups in der UI.
 */

/**
 * Normalisierungs-Strategien für eine einzelne Spalte.
 *
 * - `default`: trim, lowercase, Umlaut-Strip (äöüß), Whitespace-Collapse.
 * - `digits-only`: alles außer 0-9 verworfen (z. B. PLZ "1 23 45" → "12345").
 * - `email`: trim + lowercase. KEINE `+`-Alias-Entfernung
 *   (Gmail-typisch `max+abo@…` bleibt erhalten — Datenschutz/Domain-Policy
 *   entscheidet der Caller).
 * - `url-host`: extract hostname, strip `www.`, lowercase. Parse-Fail → "".
 */
export type DedupeNormalizer = "default" | "digits-only" | "email" | "url-host";

/**
 * Eine einzelne Dedupe-Regel. Mehrere Regeln werden in `DedupeConfig`
 * als logisches OR ausgewertet (Reihenfolge bestimmt Reason-Priorität).
 */
export interface DedupeRule {
  id: string;
  label?: string;
  /** Spalten-Header (case-sensitive Lookup gegen Row-Keys). */
  columns: string[];
  /** Optional pro-Spalte abweichende Normalisierung. Default: `"default"`. */
  normalizers?: Record<string, DedupeNormalizer>;
  enabled: boolean;
}

/**
 * Vollständige Dedupe-Konfiguration (persistierbar).
 *
 * `strategy`:
 *   - `keep-first`: Erste Sichtung überlebt, alle weiteren werden excluded.
 *   - `keep-all`: Gruppen werden erkannt, aber nichts wird excluded
 *     (rein informativ — z. B. für Audit-Reports).
 *
 * NOTE: Paket A implementiert `keep-first` semantisch immer; `keep-all`
 * wird vom Engine als "Gruppen erkennen, `excludedRowIndices` leer lassen"
 * behandelt.
 */
export interface DedupeConfig {
  enabled: boolean;
  strategy: "keep-first" | "keep-all";
  rules: DedupeRule[];
}

/**
 * Eine erkannte Duplikat-Gruppe (ein Original + n Duplikate).
 *
 * `keyPreview` enthält die NICHT-normalisierten Original-Werte der
 * matchenden Spalten — für UI-Anzeige ("Welcher Wert hat gematched?").
 */
export interface DedupeGroup {
  ruleId: string;
  originalRowIndex: number;
  duplicateRowIndices: number[];
  keyPreview: Record<string, string>;
}

/**
 * Ergebnis eines `detectDuplicates`-Laufs.
 *
 * - `excludedRowIndices`: O(1)-Lookup für "darf diese Row in den Output?"
 * - `reasonByRowIndex`: pro excluded Row die Begründung (gewinnt die
 *   ZUERST matchende Regel aus `config.rules`-Reihenfolge).
 * - `stats.perRule`: Aufschlüsselung welche Regel wie viele Duplikate fand.
 */
export interface DedupeResult {
  groups: DedupeGroup[];
  excludedRowIndices: Set<number>;
  reasonByRowIndex: Map<
    number,
    {
      ruleId: string;
      ruleLabel: string;
      originalRowIndex: number;
      matchedColumns: string[];
    }
  >;
  stats: {
    totalRows: number;
    excluded: number;
    groupCount: number;
    perRule: Array<{ ruleId: string; excluded: number }>;
  };
}
