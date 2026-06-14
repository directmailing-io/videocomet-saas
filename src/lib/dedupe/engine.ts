/**
 * Pure Dedupe-Engine.
 *
 * Deterministisch, ohne Seiteneffekte. Keine DB-/React-/Next-Imports.
 *
 * Komplexität: O(R * C) für R Rows und C Regeln (jede Regel ein
 * Hash-Map-Pass). Skip-Bedingung (leere Spalte) verhindert
 * False-Positives für "leere" Leads, in denen ein Schlüssel fehlt.
 */
import type {
  DedupeConfig,
  DedupeGroup,
  DedupeNormalizer,
  DedupeResult,
  DedupeRule,
} from "./types";

/**
 * Normalisiert einen Einzelwert für Vergleichszwecke.
 *
 * `default` wandelt deutsche Umlaute zu ASCII (ä→ae, ö→oe, ü→ue, ß→ss),
 * sodass `Müller` und `Mueller` als gleich gelten — das ist in DE-CRM-Daten
 * typischer Real-World-Fall (Excel-Import vs. Web-Form).
 */
export function normalizeValue(
  v: string | null | undefined,
  kind: DedupeNormalizer,
): string {
  if (v == null) return "";
  const s = String(v);

  switch (kind) {
    case "digits-only":
      return s.replace(/\D/g, "");

    case "email":
      // KEINE +-Alias-Entfernung — siehe types.ts JSDoc.
      return s.trim().toLowerCase();

    case "url-host": {
      const trimmed = s.trim();
      if (!trimmed) return "";
      try {
        // Wenn ohne Schema, prefix mit http:// damit URL-Parser greift.
        const withScheme = /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `http://${trimmed}`;
        const u = new URL(withScheme);
        let host = u.hostname.toLowerCase();
        if (host.startsWith("www.")) host = host.slice(4);
        return host;
      } catch {
        return "";
      }
    }

    case "default":
    default: {
      let out = s.trim().toLowerCase();
      // Umlaut-Strip — reine ASCII-Form für robusten Vergleich.
      out = out
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss");
      // Whitespace collapse: jede Whitespace-Sequenz → 1 Space.
      out = out.replace(/\s+/g, " ");
      return out;
    }
  }
}

/**
 * Prüft ob eine Row für eine Regel "matchbar" ist.
 *
 * **Skip-Regel**: Wenn IRGENDEINE der Regel-Spalten in der Row leer oder
 * nur Whitespace ist → Regel matched für diese Row NICHT. Begründung: ein
 * Lead ohne PLZ darf nicht mit allen anderen Leads ohne PLZ kollabieren.
 */
function rowHasAllColumns(
  row: Record<string, string>,
  columns: string[],
): boolean {
  for (const col of columns) {
    const raw = row[col];
    if (raw == null) return false;
    if (String(raw).trim() === "") return false;
  }
  return true;
}

/**
 * Hauptfunktion: erkennt Duplikate gemäß `config` über `rows`.
 *
 * Algorithmus:
 *   1. `config.enabled=false` → leeres Ergebnis (Kurzschluss).
 *   2. Für jede aktivierte Regel (in `config.rules`-Reihenfolge):
 *      - Map `compositeKey → firstSeenRowIndex` aufbauen.
 *      - compositeKey = Konkatenation der normalisierten Werte aller
 *        `rule.columns` (kein Separator nötig — Reihenfolge fix).
 *      - Erste Sichtung = Original. Weitere = Duplikat.
 *   3. `reasonByRowIndex` darf pro Row nur EINE Reason haben — die ZUERST
 *      matchende Regel gewinnt (deshalb äußere Schleife über Regeln).
 *   4. `strategy=keep-all` → `excludedRowIndices` bleibt leer
 *      (Gruppen werden trotzdem reported).
 */
export function detectDuplicates(
  rows: Record<string, string>[],
  config: DedupeConfig,
): DedupeResult {
  const groups: DedupeGroup[] = [];
  const excludedRowIndices = new Set<number>();
  const reasonByRowIndex = new Map<
    number,
    {
      ruleId: string;
      ruleLabel: string;
      originalRowIndex: number;
      matchedColumns: string[];
    }
  >();
  const perRule: Array<{ ruleId: string; excluded: number }> = [];

  if (!config.enabled) {
    return {
      groups,
      excludedRowIndices,
      reasonByRowIndex,
      stats: {
        totalRows: rows.length,
        excluded: 0,
        groupCount: 0,
        perRule,
      },
    };
  }

  const keepAll = config.strategy === "keep-all";

  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    if (rule.columns.length === 0) continue;

    // Map composite-key → erster Row-Index, der diesen Key sah.
    // Zweite Map: composite-key → DedupeGroup, damit weitere Duplikate
    // an die gleiche Gruppe gehängt werden statt neue Gruppen anzulegen.
    const firstSeen = new Map<string, number>();
    const groupByKey = new Map<string, DedupeGroup>();
    let ruleExcluded = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Skip-Bedingung: leere Pflicht-Spalte → keine Falsch-Matches.
      if (!rowHasAllColumns(row, rule.columns)) continue;

      // Composite-Key bauen — Konkatenation ist OK, da columns fix
      // sind und normalizeValue niemals Separator-Konflikte erzeugt
      // (alle Outputs sind reine Daten-Strings).
      let key = "";
      for (const col of rule.columns) {
        const norm = rule.normalizers?.[col] ?? "default";
        key += normalizeValue(row[col], norm);
      }

      // Leerer Key (z. B. url-host Parse-Fail auf alle Felder) → skip,
      // sonst würden alle Parse-Fails kollabieren.
      if (key === "") continue;

      const firstIdx = firstSeen.get(key);
      if (firstIdx === undefined) {
        firstSeen.set(key, i);
        continue;
      }

      // Duplikat-Treffer.
      let group = groupByKey.get(key);
      if (!group) {
        // keyPreview = ORIGINAL-Werte (nicht normalisiert) aus der
        // ERSTEN Sichtung — User sieht "12345 " statt "12345" o. ä.
        const keyPreview: Record<string, string> = {};
        for (const col of rule.columns) {
          keyPreview[col] = String(rows[firstIdx][col] ?? "");
        }
        group = {
          ruleId: rule.id,
          originalRowIndex: firstIdx,
          duplicateRowIndices: [],
          keyPreview,
        };
        groupByKey.set(key, group);
        groups.push(group);
      }
      group.duplicateRowIndices.push(i);

      // Exclusion + Reason — nur wenn nicht keep-all.
      if (!keepAll) {
        if (!excludedRowIndices.has(i)) {
          excludedRowIndices.add(i);
          ruleExcluded++;
        }
        // Erste matchende Regel gewinnt (Reihenfolge in config.rules).
        if (!reasonByRowIndex.has(i)) {
          reasonByRowIndex.set(i, {
            ruleId: rule.id,
            ruleLabel: rule.label ?? rule.id,
            originalRowIndex: firstIdx,
            matchedColumns: [...rule.columns],
          });
        }
      }
    }

    perRule.push({ ruleId: rule.id, excluded: ruleExcluded });
  }

  return {
    groups,
    excludedRowIndices,
    reasonByRowIndex,
    stats: {
      totalRows: rows.length,
      excluded: excludedRowIndices.size,
      groupCount: groups.length,
      perRule,
    },
  };
}

// Re-Export für Konsumenten die nur engine.ts importieren wollen.
export type {
  DedupeConfig,
  DedupeGroup,
  DedupeNormalizer,
  DedupeResult,
  DedupeRule,
};
