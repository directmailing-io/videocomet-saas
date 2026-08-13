import { describe, expect, it } from "vitest";
import { sortLeadsForBundle } from "./bundle-helpers";
import type { Lead } from "@/lib/db/queries/leads";

let seq = 0;
function lead(data: Record<string, string>, rowIndex?: number): Lead {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    rowIndex: rowIndex ?? seq,
    data,
  } as unknown as Lead;
}

function values(leads: Lead[], field: string): string[] {
  return leads.map(
    (l) => ((l.data ?? {}) as Record<string, string>)[field] ?? "",
  );
}

describe("sortLeadsForBundle", () => {
  it("gibt ohne Spalte eine Kopie in unveränderter Reihenfolge zurück", () => {
    const input = [
      lead({ Vorname: "Zora" }, 0),
      lead({ Vorname: "Anna" }, 1),
      lead({ Vorname: "Mia" }, 2),
    ];
    for (const col of [undefined, null, "", "  "]) {
      const out = sortLeadsForBundle(input, col);
      expect(out).not.toBe(input);
      expect(values(out, "Vorname")).toEqual(["Zora", "Anna", "Mia"]);
    }
  });

  it("sortiert alphabetisch nach gewählter Spalte (case-insensitiv, Umlaute deutsch)", () => {
    const input = [
      lead({ Vorname: "zora" }),
      lead({ Vorname: "Änne" }),
      lead({ Vorname: "Anna" }),
      lead({ Vorname: "Bernd" }),
    ];
    const out = sortLeadsForBundle(input, "Vorname");
    expect(values(out, "Vorname")).toEqual(["Anna", "Änne", "Bernd", "zora"]);
  });

  it("sortiert PLZ-Spalte numerisch aufsteigend (führende Nullen korrekt)", () => {
    const input = [
      lead({ PLZ: "10115" }),
      lead({ PLZ: "01067" }),
      lead({ PLZ: "99084" }),
      lead({ PLZ: "80331" }),
    ];
    const out = sortLeadsForBundle(input, "PLZ");
    expect(values(out, "PLZ")).toEqual(["01067", "10115", "80331", "99084"]);
  });

  it("matcht Spaltennamen tolerant über Schreibvarianten (Groß/klein, snake_case, Umlaute)", () => {
    const input = [
      lead({ first_name: "Zora" }),
      lead({ firstname: "Anna" }),
      lead({ "First-Name": "Mia" }),
    ];
    const out = sortLeadsForBundle(input, "First_Name");
    const names = out.map((l) => {
      const d = (l.data ?? {}) as Record<string, string>;
      return d.first_name ?? d.firstname ?? d["First-Name"];
    });
    expect(names).toEqual(["Anna", "Mia", "Zora"]);
  });

  it("stellt Leads ohne Wert in der Spalte ans Ende (Original-Reihenfolge)", () => {
    const input = [
      lead({ Vorname: "" }, 0),
      lead({ Vorname: "Bernd" }, 1),
      lead({}, 2),
      lead({ Vorname: "Anna" }, 3),
    ];
    const out = sortLeadsForBundle(input, "Vorname");
    expect(out.map((l) => l.rowIndex)).toEqual([3, 1, 0, 2]);
  });

  it("sortiert bei unbekannter Spalte stabil in Original-Reihenfolge", () => {
    const input = [
      lead({ Vorname: "Zora" }, 0),
      lead({ Vorname: "Anna" }, 1),
      lead({ Vorname: "Mia" }, 2),
    ];
    const out = sortLeadsForBundle(input, "GibtEsNicht");
    expect(out.map((l) => l.rowIndex)).toEqual([0, 1, 2]);
  });

  it("ist deterministisch: getrennte Aufrufe (Brief/Umschlag) liefern identische Reihenfolge", () => {
    const input = [
      lead({ Vorname: "Anna" }, 5),
      lead({ Vorname: "Anna" }, 2),
      lead({ Vorname: "Anna" }, 9),
    ];
    const shuffled = [input[2], input[0], input[1]] as Lead[];
    const a = sortLeadsForBundle(input, "Vorname").map((l) => l.id);
    const b = sortLeadsForBundle(shuffled, "Vorname").map((l) => l.id);
    expect(b).toEqual(a);
    // Gleicher Wert → Tiebreaker rowIndex
    expect(sortLeadsForBundle(input, "Vorname").map((l) => l.rowIndex)).toEqual([
      2, 5, 9,
    ]);
  });

  it("sortiert absteigend, wenn direction 'desc' ist", () => {
    const input = [
      lead({ Vorname: "Anna" }),
      lead({ Vorname: "zora" }),
      lead({ Vorname: "Bernd" }),
    ];
    const out = sortLeadsForBundle(input, "Vorname", "desc");
    expect(values(out, "Vorname")).toEqual(["zora", "Bernd", "Anna"]);
  });

  it("stellt Leads ohne Wert auch bei 'desc' ans Ende", () => {
    const input = [
      lead({ Vorname: "" }, 0),
      lead({ Vorname: "Anna" }, 1),
      lead({}, 2),
      lead({ Vorname: "Bernd" }, 3),
    ];
    const out = sortLeadsForBundle(input, "Vorname", "desc");
    expect(out.map((l) => l.rowIndex)).toEqual([3, 1, 0, 2]);
  });

  it("nutzt bei 'desc' und gleichem Wert weiterhin rowIndex aufsteigend als Tiebreaker", () => {
    const input = [
      lead({ Vorname: "Anna" }, 9),
      lead({ Vorname: "Anna" }, 2),
      lead({ Vorname: "Anna" }, 5),
    ];
    const out = sortLeadsForBundle(input, "Vorname", "desc");
    expect(out.map((l) => l.rowIndex)).toEqual([2, 5, 9]);
  });

  it("mutiert den Input nicht", () => {
    const input = [lead({ Vorname: "Zora" }, 0), lead({ Vorname: "Anna" }, 1)];
    const before = input.map((l) => l.id);
    sortLeadsForBundle(input, "Vorname");
    expect(input.map((l) => l.id)).toEqual(before);
  });
});
