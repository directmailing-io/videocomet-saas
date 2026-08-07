/**
 * Tests für die System-Context-Erweiterung von `substitute()`
 * (Paket A, Thumbnail-Generator).
 *
 * Wichtigster Vertrag:
 *   - `system.pageUrl` ist Vorrang vor allem anderen (auch über
 *     Lead-Daten + Mapping → System gewinnt, Konfliktauflösung).
 *   - Backward-Compat: ohne `system` verhält sich substitute exakt
 *     wie vor Paket A.
 *   - Wenn System-Wert nicht gesetzt / leer → normale Lookup-Kette.
 */
import { describe, expect, it } from "vitest";
import {
  SYSTEM_PLACEHOLDERS,
  coversEmptyValue,
  firstNameCoveredWhenEmpty,
  substitute,
} from "@/lib/placeholders/substitute";

describe("substitute — SYSTEM_PLACEHOLDERS export", () => {
  it("enthält pageUrl", () => {
    expect(SYSTEM_PLACEHOLDERS).toContain("pageUrl");
  });
});

describe("substitute — system.pageUrl im Template", () => {
  it("ersetzt {{pageUrl}} im double-brace-Format durch system-Wert", () => {
    const out = substitute(
      "Dein Video: {{pageUrl}}",
      { firstName: "Simon" },
      undefined,
      "double-brace",
      { pageUrl: "video.digispace.at/simon-krempel" },
    );
    expect(out).toBe("Dein Video: video.digispace.at/simon-krempel");
  });

  it("ersetzt {{pageUrl}} im double-brace-fallback-Format", () => {
    const out = substitute(
      "Link: {{pageUrl|fallback.de}}",
      {},
      undefined,
      "double-brace-fallback",
      { pageUrl: "app.videocomet.de/v/anna" },
    );
    expect(out).toBe("Link: app.videocomet.de/v/anna");
  });

  it("ersetzt {{pageUrl}} in tiptap-span-Format (Roh-Token im HTML)", () => {
    const out = substitute(
      "<p>URL: {{pageUrl}}</p>",
      {},
      undefined,
      "tiptap-span",
      { pageUrl: "video.x.de/y" },
    );
    expect(out).toBe("<p>URL: video.x.de/y</p>");
  });

  it("ersetzt {{pageUrl}} in tiptap-span-Format via data-placeholder", () => {
    const out = substitute(
      `<span data-placeholder="pageUrl">{{pageUrl}}</span>`,
      {},
      undefined,
      "tiptap-span",
      { pageUrl: "video.x.de/y" },
    );
    expect(out).toBe("video.x.de/y");
  });
});

describe("substitute — System gewinnt vor Lead-Daten", () => {
  it("System-pageUrl überschreibt eine gleichnamige CSV-Spalte (Konfliktfall)", () => {
    // Lead-Daten enthalten fälschlich einen `pageUrl`-Key (z.B. weil der
    // User die Spalte so genannt hat). System.pageUrl ist gesetzt →
    // System gewinnt, der CSV-Wert wird ignoriert.
    const out = substitute(
      "{{pageUrl}}",
      { pageUrl: "EVIL.csv-value" },
      undefined,
      "double-brace",
      { pageUrl: "trusted.example/slug" },
    );
    expect(out).toBe("trusted.example/slug");
  });

  it("System-pageUrl gewinnt auch wenn Mapping pageUrl auf andere Spalte zeigt", () => {
    const out = substitute(
      "{{pageUrl}}",
      { url: "from-csv.de/foo" },
      { pageUrl: { column: "url" } },
      "double-brace",
      { pageUrl: "trusted.example/slug" },
    );
    expect(out).toBe("trusted.example/slug");
  });

  it("Wenn system.pageUrl null/leer ist → normale Lookup-Kette (Lead-Daten)", () => {
    const out = substitute(
      "{{pageUrl}}",
      { pageUrl: "fallback-csv-value" },
      undefined,
      "double-brace",
      { pageUrl: null },
    );
    expect(out).toBe("fallback-csv-value");
  });

  it("Wenn kein system-Arg übergeben wird → backward-compat: leadData greift", () => {
    const out = substitute(
      "{{pageUrl}}",
      { pageUrl: "from-csv" },
      undefined,
      "double-brace",
    );
    expect(out).toBe("from-csv");
  });
});

describe("substitute — Backward-Compatibility", () => {
  it("alte 4-Arg-Signatur funktioniert weiter (kein system)", () => {
    const out = substitute(
      "Hi {{firstName}}",
      { firstName: "Anna" },
      undefined,
      "double-brace",
    );
    expect(out).toBe("Hi Anna");
  });

  it("Lead-Daten + Mapping ohne System verhalten sich wie vorher", () => {
    const out = substitute(
      "Hi {{firstName}}, {{city|Berlin}}",
      { Vorname: "Bo" },
      { firstName: { column: "Vorname" } },
      "double-brace-fallback",
    );
    expect(out).toBe("Hi Bo, Berlin");
  });

  it("nicht-System-Keys werden vom system-Arg NICHT betroffen", () => {
    const out = substitute(
      "{{firstName}} | {{pageUrl}}",
      { firstName: "Lara" },
      undefined,
      "double-brace",
      { pageUrl: "page.example/lara" },
    );
    expect(out).toBe("Lara | page.example/lara");
  });
});

describe("substitute — Slug-Engine schützt vor zirkulärem pageUrl", () => {
  it("single-brace mit {pageUrl} würde im system-Pfad ausgeliefert (Slug-Engine strippt es vorher)", () => {
    // substitute selbst kennt keinen Sonderfall für single-brace +
    // pageUrl — der Schutz sitzt in `renderSlugTemplate`. Hier nur die
    // Erinnerung: wenn jemand substitute() direkt mit single-brace +
    // system.pageUrl benutzt, klappt das (das tun wir aber bewusst NICHT
    // im Slug-Code, siehe slug.ts stripSystemTokens).
    const out = substitute(
      "{pageUrl}",
      {},
      undefined,
      "single-brace",
      { pageUrl: "x.example/y" },
    );
    expect(out).toBe("x.example/y");
  });
});

describe("coversEmptyValue — leere Zellen im Mapping abgedeckt?", () => {
  it("false für undefined / leeren Eintrag / leeren Fallback", () => {
    expect(coversEmptyValue(undefined)).toBe(false);
    expect(coversEmptyValue({})).toBe(false);
    expect(coversEmptyValue({ column: "Vorname" })).toBe(false);
    expect(coversEmptyValue({ column: "Vorname", fallback: "" })).toBe(false);
  });

  it("true bei nicht-leerem Fallback", () => {
    expect(coversEmptyValue({ column: "Vorname", fallback: "Team" })).toBe(true);
  });

  it("true bei explizitem „leer lassen“", () => {
    expect(coversEmptyValue({ empty: true })).toBe(true);
  });

  it("true bei is_empty-Regel, false bei nur-equals-Regeln", () => {
    expect(
      coversEmptyValue({
        column: "Vorname",
        rules: [{ op: "is_empty", output: "dort" }],
      }),
    ).toBe(true);
    expect(
      coversEmptyValue({
        column: "Land",
        rules: [{ op: "equals", match: "AT", output: "" }],
      }),
    ).toBe(false);
  });
});

describe("firstNameCoveredWhenEmpty — Vorname-Keys im Mapping", () => {
  it("false ohne Mapping oder ohne Vorname-Key", () => {
    expect(firstNameCoveredWhenEmpty(undefined)).toBe(false);
    expect(firstNameCoveredWhenEmpty(null)).toBe(false);
    expect(
      firstNameCoveredWhenEmpty({ firma: { column: "Firma", fallback: "x" } }),
    ).toBe(false);
  });

  it("false wenn Vorname gemappt aber ohne Fallback", () => {
    expect(
      firstNameCoveredWhenEmpty({ vorname: { column: "Vorname" } }),
    ).toBe(false);
  });

  it("true wenn IRGENDEIN Vorname-Key abgedeckt ist (case-insensitive)", () => {
    expect(
      firstNameCoveredWhenEmpty({
        vorname: { column: "Vorname" },
        firstName: { column: "Vorname", fallback: "liebes Team" },
      }),
    ).toBe(true);
    expect(
      firstNameCoveredWhenEmpty({ Vorname: { empty: true } }),
    ).toBe(true);
  });
});
