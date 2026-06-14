/**
 * Engine-Tests für Paket A.
 *
 * Stil orientiert an `src/lib/slug-reserved.test.ts`:
 * vitest, describe/it, sprechende Test-Namen, fokussiert auf
 * Real-World-Edge-Cases (Umlaute, Whitespace, leere Felder).
 */
import { describe, expect, it } from "vitest";
import { detectDuplicates, normalizeValue } from "@/lib/dedupe/engine";
import type { DedupeConfig } from "@/lib/dedupe/types";

describe("normalizeValue", () => {
  it("default: Umlaut-Strip + lowercase + Whitespace-Collapse", () => {
    expect(normalizeValue("  Müller  GmbH  ", "default")).toBe(
      "mueller gmbh",
    );
    expect(normalizeValue("Weiß", "default")).toBe("weiss");
  });

  it("digits-only: alles ausser Ziffern verworfen", () => {
    expect(normalizeValue(" 1 23 45 ", "digits-only")).toBe("12345");
    expect(normalizeValue("DE-12345", "digits-only")).toBe("12345");
  });

  it("email: trim + lowercase, KEINE +-Alias-Entfernung", () => {
    expect(normalizeValue(" Max+Abo@Foo.DE ", "email")).toBe(
      "max+abo@foo.de",
    );
  });

  it("url-host: hostname + www-strip, Parse-Fail → leerer String", () => {
    expect(normalizeValue("https://www.Example.COM/x?y=1", "url-host")).toBe(
      "example.com",
    );
    expect(normalizeValue("example.com", "url-host")).toBe("example.com");
    expect(normalizeValue("not a url", "url-host")).toBe("");
  });
});

describe("detectDuplicates — Email-Regel", () => {
  it("matched case-insensitive (Max@Foo.DE vs max@foo.de)", () => {
    const rows = [
      { email: "Max@Foo.DE" },
      { email: "max@foo.de" },
      { email: "anna@bar.de" },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "E-Mail",
          columns: ["email"],
          normalizers: { email: "email" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.has(1)).toBe(true);
    expect(res.excludedRowIndices.has(0)).toBe(false);
    expect(res.excludedRowIndices.has(2)).toBe(false);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].originalRowIndex).toBe(0);
    expect(res.groups[0].duplicateRowIndices).toEqual([1]);
    // keyPreview = ORIGINAL-Wert der ersten Sichtung.
    expect(res.groups[0].keyPreview.email).toBe("Max@Foo.DE");
  });
});

describe("detectDuplicates — Skip-Bedingung", () => {
  it("leere PLZ in einer Row triggert KEINEN Match (kein False-Positive)", () => {
    const rows = [
      { vorname: "Max", nachname: "Müller", plz: "12345" },
      // PLZ leer → diese Row darf NICHT mit Row 0 oder Row 2 matchen.
      { vorname: "Max", nachname: "Müller", plz: "" },
      { vorname: "Max", nachname: "Müller", plz: "   " },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          normalizers: { plz: "digits-only" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    // Niemand excluded — keine Row hat zwei volle Sätze.
    expect(res.excludedRowIndices.size).toBe(0);
    expect(res.groups).toHaveLength(0);
    expect(res.stats.totalRows).toBe(3);
  });
});

describe("detectDuplicates — Umlaut-Normalisierung", () => {
  it("Müller vs mueller mit identischer PLZ → Duplikat", () => {
    const rows = [
      { vorname: "Max", nachname: "Müller", plz: "12345" },
      { vorname: "max", nachname: "mueller", plz: "12345" },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          normalizers: { plz: "digits-only" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.has(1)).toBe(true);
    expect(res.groups).toHaveLength(1);
  });
});

describe("detectDuplicates — Mehrere Regeln (OR + Reason-Priorität)", () => {
  it("Row matched Regel 1 UND Regel 2 → reasonByRowIndex zeigt Regel 1", () => {
    const rows = [
      { email: "max@foo.de", vorname: "Max", nachname: "Müller", plz: "12345" },
      // Matched BEIDE Regeln (gleiche Email + gleicher Name+PLZ).
      { email: "max@foo.de", vorname: "Max", nachname: "Müller", plz: "12345" },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "rEmail",
          label: "E-Mail",
          columns: ["email"],
          normalizers: { email: "email" },
          enabled: true,
        },
        {
          id: "rVNP",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          normalizers: { plz: "digits-only" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.has(1)).toBe(true);
    const reason = res.reasonByRowIndex.get(1);
    expect(reason).toBeDefined();
    // Erste matchende Regel gewinnt → "rEmail".
    expect(reason?.ruleId).toBe("rEmail");
    expect(reason?.ruleLabel).toBe("E-Mail");
  });
});

describe("detectDuplicates — Whitespace + digits-only", () => {
  it("PLZ '12345 ' vs '12345' matched (default-Trim greift)", () => {
    const rows = [
      { vorname: "max", nachname: "mueller", plz: "12345 " },
      { vorname: "max", nachname: "mueller", plz: "12345" },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          // Bewusst OHNE digits-only — default greift trim/lowercase.
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.has(1)).toBe(true);
  });

  it("PLZ '12345' vs '1 2 3 4 5' mit digits-only normalizer → match", () => {
    const rows = [
      { vorname: "max", nachname: "mueller", plz: "12345" },
      { vorname: "max", nachname: "mueller", plz: "1 2 3 4 5" },
    ];
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          normalizers: { plz: "digits-only" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.has(1)).toBe(true);
  });
});

describe("detectDuplicates — config.enabled=false", () => {
  it("liefert leeres Ergebnis (Kurzschluss)", () => {
    const rows = [
      { email: "a@a.de" },
      { email: "a@a.de" },
    ];
    const config: DedupeConfig = {
      enabled: false,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "E-Mail",
          columns: ["email"],
          normalizers: { email: "email" },
          enabled: true,
        },
      ],
    };
    const res = detectDuplicates(rows, config);
    expect(res.excludedRowIndices.size).toBe(0);
    expect(res.groups).toHaveLength(0);
    expect(res.reasonByRowIndex.size).toBe(0);
    expect(res.stats.totalRows).toBe(2);
    expect(res.stats.excluded).toBe(0);
  });
});

describe("detectDuplicates — Performance", () => {
  it("5000 Rows mit 3 Regeln in < 200ms", () => {
    // Synthetische Daten: 5000 Rows, jede 3. ist Duplikat von Row 0.
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < 5000; i++) {
      const isDup = i % 3 === 0 && i > 0;
      rows.push(
        isDup
          ? {
              email: "max@foo.de",
              vorname: "Max",
              nachname: "Müller",
              plz: "12345",
              firma: "Acme",
            }
          : {
              email: `user${i}@foo.de`,
              vorname: `Vor${i}`,
              nachname: `Nach${i}`,
              plz: String(10000 + (i % 9000)),
              firma: `Firma${i}`,
            },
      );
    }
    const config: DedupeConfig = {
      enabled: true,
      strategy: "keep-first",
      rules: [
        {
          id: "r1",
          label: "E-Mail",
          columns: ["email"],
          normalizers: { email: "email" },
          enabled: true,
        },
        {
          id: "r2",
          label: "V+N+PLZ",
          columns: ["vorname", "nachname", "plz"],
          normalizers: { plz: "digits-only" },
          enabled: true,
        },
        {
          id: "r3",
          label: "V+N+Firma",
          columns: ["vorname", "nachname", "firma"],
          enabled: true,
        },
      ],
    };

    const t0 = performance.now();
    const res = detectDuplicates(rows, config);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(200);
    // Sanity: es wurden tatsächlich Duplikate erkannt.
    expect(res.excludedRowIndices.size).toBeGreaterThan(1000);
  });
});
