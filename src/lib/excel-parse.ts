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
