/**
 * XLSX parser used by Run-Upload.
 *
 * Uses SheetJS (xlsx) with `raw: false` so cells are returned as their
 * formatted string representation (matching what the user sees in Excel).
 */

import * as XLSX from "xlsx";

export interface ParseXlsxResult {
  headers: string[];
  rows: Record<string, string>[];
  sheetNames: string[];
  sheetName: string;
}

function clean(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Zaehlt die Zeilen jedes Tabs OHNE alle Zellen zu formatieren — nutzt das
 * `!ref`-Range statt sheet_to_json, damit die Antwort auch bei grossen
 * Files unter 1s bleibt. Fuer den Multi-Tab-Picker im Wizard.
 */
export interface XlsxTabInfo {
  index: number;
  name: string;
  rowCount: number;
  columnCount: number;
  isEmpty: boolean;
}

export function getXlsxTabs(buffer: Buffer): XlsxTabInfo[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    // Nur Bookkeeping — WIR wollen keine cell values, die Range reicht.
    sheetRows: 0,
    bookSheets: true,
  });
  const names = workbook.SheetNames ?? [];
  return names.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const ref = sheet?.["!ref"];
    if (!ref) {
      return { index, name, rowCount: 0, columnCount: 0, isEmpty: true };
    }
    const decoded = XLSX.utils.decode_range(ref);
    // decoded ist 0-basiert und exklusiv → +1 fuer Anzeige, −1 fuer Header-Zeile.
    const rowCount = Math.max(0, decoded.e.r - decoded.s.r);
    const columnCount = decoded.e.c - decoded.s.c + 1;
    return {
      index,
      name,
      rowCount,
      columnCount,
      isEmpty: rowCount === 0,
    };
  });
}

export function parseXLSX(buffer: Buffer, sheetName?: string): ParseXlsxResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return { headers: [], rows: [], sheetNames: [], sheetName: "" };
  }

  const chosen =
    sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const sheet = workbook.Sheets[chosen];

  // `header: 1` returns rows as arrays; `raw: false` formats values to strings.
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (aoa.length === 0) {
    return { headers: [], rows: [], sheetNames, sheetName: chosen };
  }

  const headerRow = aoa[0].map((h, i) => clean(h) || `Spalte ${i + 1}`);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const cells = aoa[i];
    if (!cells || cells.every((c) => clean(c) === "")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headerRow.length; c += 1) {
      row[headerRow[c]] = clean(cells[c]);
    }
    rows.push(row);
  }

  return { headers: headerRow, rows, sheetNames, sheetName: chosen };
}
