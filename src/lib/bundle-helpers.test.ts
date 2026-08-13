import { describe, expect, it } from "vitest";
import { sortLeadsForBundle, type BundleSort } from "./bundle-helpers";
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

function names(leads: Lead[], field: string): string[] {
  return leads.map(
    (l) => ((l.data ?? {}) as Record<string, string>)[field] ?? "",
  );
}

describe("sortLeadsForBundle", () => {
  it("gibt bei 'original' eine Kopie in unveränderter Reihenfolge zurück", () => {
    const input = [
      lead({ Vorname: "Zora" }, 0),
      lead({ Vorname: "Anna" }, 1),
      lead({ Vorname: "Mia" }, 2),
    ];
    const out = sortLeadsForBundle(input, "original");
    expect(out).not.toBe(input);
    expect(names(out, "Vorname")).toEqual(["Zora", "Anna", "Mia"]);
  });

  it("sortiert alphabetisch nach Vorname (case-insensitiv, Umlaute deutsch)", () => {
    const input = [
      lead({ Vorname: "zora" }),
      lead({ Vorname: "Änne" }),
      lead({ Vorname: "Anna" }),
      lead({ Vorname: "Bernd" }),
    ];
    const out = sortLeadsForBundle(input, "firstName");
    expect(names(out, "Vorname")).toEqual(["Anna", "Änne", "Bernd", "zora"]);
  });

  it("sortiert nach Nachname mit Vorname als Sekundär-Schlüssel", () => {
    const input = [
      lead({ Vorname: "Klaus", Nachname: "Müller" }),
      lead({ Vorname: "Anna", Nachname: "Müller" }),
      lead({ Vorname: "Zora", Nachname: "Abel" }),
    ];
    const out = sortLeadsForBundle(input, "lastName");
    expect(names(out, "Vorname")).toEqual(["Zora", "Anna", "Klaus"]);
  });

  it("sortiert PLZ numerisch aufsteigend (führende Nullen korrekt)", () => {
    const input = [
      lead({ PLZ: "10115" }),
      lead({ PLZ: "01067" }),
      lead({ PLZ: "99084" }),
      lead({ PLZ: "80331" }),
    ];
    const out = sortLeadsForBundle(input, "zip");
    expect(names(out, "PLZ")).toEqual(["01067", "10115", "80331", "99084"]);
  });

  it("findet Felder über heterogene CSV-Spaltennamen", () => {
    const input = [
      lead({ first_name: "Zora" }),
      lead({ firstName: "Anna" }),
      lead({ Vorname: "Mia" }),
    ];
    const out = sortLeadsForBundle(input, "firstName");
    const values = out.map((l) => {
      const d = (l.data ?? {}) as Record<string, string>;
      return d.Vorname ?? d.firstName ?? d.first_name;
    });
    expect(values).toEqual(["Anna", "Mia", "Zora"]);
  });

  it("stellt Leads ohne Wert im Sortierfeld ans Ende (Original-Reihenfolge)", () => {
    const input = [
      lead({ Vorname: "" }, 0),
      lead({ Vorname: "Bernd" }, 1),
      lead({}, 2),
      lead({ Vorname: "Anna" }, 3),
    ];
    const out = sortLeadsForBundle(input, "firstName");
    expect(out.map((l) => l.rowIndex)).toEqual([3, 1, 0, 2]);
  });

  it("ist deterministisch: getrennte Aufrufe (Brief/Umschlag) liefern identische Reihenfolge", () => {
    const input = [
      lead({ Vorname: "Anna", Nachname: "Meier" }, 5),
      lead({ Vorname: "Anna", Nachname: "Meier" }, 2),
      lead({ Vorname: "Anna", Nachname: "Meier" }, 9),
    ];
    const shuffled = [input[2], input[0], input[1]] as Lead[];
    for (const sort of ["firstName", "lastName", "zip", "city"] as BundleSort[]) {
      const a = sortLeadsForBundle(input, sort).map((l) => l.id);
      const b = sortLeadsForBundle(shuffled, sort).map((l) => l.id);
      expect(b).toEqual(a);
    }
    // Gleicher Name → Tiebreaker rowIndex
    expect(sortLeadsForBundle(input, "firstName").map((l) => l.rowIndex)).toEqual([
      2, 5, 9,
    ]);
  });

  it("sortiert nach Ort mit PLZ als Sekundär-Schlüssel", () => {
    const input = [
      lead({ Stadt: "Berlin", PLZ: "10999" }),
      lead({ Ort: "Aachen", PLZ: "52062" }),
      lead({ city: "Berlin", PLZ: "10115" }),
    ];
    const out = sortLeadsForBundle(input, "city");
    expect(names(out, "PLZ")).toEqual(["52062", "10115", "10999"]);
  });

  it("mutiert den Input nicht", () => {
    const input = [lead({ Vorname: "Zora" }, 0), lead({ Vorname: "Anna" }, 1)];
    const before = input.map((l) => l.id);
    sortLeadsForBundle(input, "firstName");
    expect(input.map((l) => l.id)).toEqual(before);
  });
});
