/**
 * Robust CSV parser used by Run-Upload.
 *
 * Goals:
 *  - Correctly handle UTF-8 with/without BOM and fall back to Windows-1252
 *    (the dialect Excel produces by default on German Windows machines).
 *  - Auto-detect delimiter from the header line (`,`, `;`, `\t`, `|`).
 *  - Return rows as `Record<string,string>` keyed by the header values, with
 *    all values trimmed.
 */

import Papa from "papaparse";

export interface ParseCsvResult {
  headers: string[];
  rows: Record<string, string>[];
  encoding: "utf-8" | "windows-1252";
  delimiter: string;
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
const REPLACEMENT_CHAR = "�";

function stripBom(buf: Buffer): Buffer {
  if (
    buf.length >= 3 &&
    buf[0] === BOM_UTF8[0] &&
    buf[1] === BOM_UTF8[1] &&
    buf[2] === BOM_UTF8[2]
  ) {
    return buf.subarray(3);
  }
  return buf;
}

/**
 * Decodes the buffer using UTF-8 first; if the result contains replacement
 * characters (typical for German umlauts in CP1252 files) we re-decode as
 * Windows-1252 and return that.
 */
function decode(buf: Buffer): { text: string; encoding: "utf-8" | "windows-1252" } {
  const stripped = stripBom(buf);

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(stripped);
  if (!utf8.includes(REPLACEMENT_CHAR)) {
    return { text: utf8, encoding: "utf-8" };
  }

  try {
    const cp1252 = new TextDecoder("windows-1252", { fatal: false }).decode(
      stripped,
    );
    return { text: cp1252, encoding: "windows-1252" };
  } catch {
    return { text: utf8, encoding: "utf-8" };
  }
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Picks the delimiter whose count is largest on the *header* line.
 * Falls back to comma when the file has no delimiter at all.
 */
function detectDelimiter(text: string): string {
  // Use first non-empty line; CSVs sometimes start with empty lines.
  const firstLine =
    text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  let best: { delim: string; count: number } = { delim: ",", count: 0 };
  for (const d of CANDIDATE_DELIMITERS) {
    const count = (firstLine.match(new RegExp(escapeRegExp(d), "g")) ?? []).length;
    if (count > best.count) {
      best = { delim: d, count };
    }
  }
  return best.delim;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trims a cell value while preserving inner whitespace.
 * Returns "" for null/undefined.
 */
function clean(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Parses a CSV buffer into headers + rows of trimmed strings.
 *
 * Bonus: handles quoted strings, multi-line cells, and CRLF correctly via
 * PapaParse defaults.
 */
export function parseCSV(buffer: Buffer): ParseCsvResult {
  const { text, encoding } = decode(buffer);
  const delimiter = detectDelimiter(text);

  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
    header: false,
    transform: (v) => v,
  });

  const rowsRaw = (result.data ?? []) as string[][];
  if (rowsRaw.length === 0) {
    return { headers: [], rows: [], encoding, delimiter };
  }

  const headerRow = rowsRaw[0].map((h, i) =>
    clean(h) || `Spalte ${i + 1}`,
  );

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < rowsRaw.length; i += 1) {
    const cells = rowsRaw[i];
    if (!cells || cells.every((c) => clean(c) === "")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headerRow.length; c += 1) {
      row[headerRow[c]] = clean(cells[c]);
    }
    rows.push(row);
  }

  return { headers: headerRow, rows, encoding, delimiter };
}
