import { describe, expect, it } from "vitest";

import { findDuplicates, validateLeadInline } from "./inline-validate";

describe("validateLeadInline — URL ohne Schema", () => {
  it("akzeptiert nackte Domains (gekaufte Lead-Listen)", () => {
    const r = validateLeadInline({
      firstName: "Anna",
      websiteUrl: "zahnarzt-ciecior.de",
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("akzeptiert www-Domains und Pfade ohne Schema", () => {
    expect(
      validateLeadInline({ firstName: "A", websiteUrl: "www.firma.de/karriere" })
        .ok,
    ).toBe(true);
  });

  it("akzeptiert weiterhin URLs mit explizitem Schema", () => {
    expect(
      validateLeadInline({ firstName: "A", websiteUrl: "https://firma.de" }).ok,
    ).toBe(true);
    expect(
      validateLeadInline({ firstName: "A", websiteUrl: "http://firma.de" }).ok,
    ).toBe(true);
  });

  it("lehnt Single-Label-Hosts und private Hosts ab", () => {
    for (const bad of [
      "localhost",
      "http://localhost:3000",
      "192.168.1.10",
      "10.0.0.5",
      "intranet",
    ]) {
      const r = validateLeadInline({ firstName: "A", websiteUrl: bad });
      expect(r.issues).toContain("invalid_url");
    }
  });

  it("lehnt Nicht-http-Schemata ab", () => {
    expect(
      validateLeadInline({ firstName: "A", websiteUrl: "ftp://firma.de" })
        .issues,
    ).toContain("invalid_url");
  });

  it("meldet fehlende Pflichtfelder", () => {
    const r = validateLeadInline({});
    expect(r.issues).toContain("missing_firstName");
    expect(r.issues).toContain("missing_websiteUrl");
  });
});

describe("findDuplicates — schemalose URLs", () => {
  it("erkennt gleiche Person auf gleicher Domain trotz Schema-Mix", () => {
    const dupes = findDuplicates([
      {
        id: "a",
        data: { firstName: "Max", lastName: "Muster", websiteUrl: "firma.de" },
      },
      {
        id: "b",
        data: {
          firstName: "Max",
          lastName: "Muster",
          websiteUrl: "https://www.firma.de",
        },
      },
    ]);
    expect(dupes.get("b")).toBe("a");
  });

  it("zählt verschiedene Personen derselben Domain NICHT als Duplikat", () => {
    const dupes = findDuplicates([
      {
        id: "a",
        data: { firstName: "Max", lastName: "Muster", websiteUrl: "firma.de" },
      },
      {
        id: "b",
        data: { firstName: "Marie", lastName: "Muster", websiteUrl: "firma.de" },
      },
    ]);
    expect(dupes.size).toBe(0);
  });
});
