import { describe, expect, it } from "vitest";
import { formatCompanyName, formatPersonName } from "./format-name";

describe("formatPersonName", () => {
  it("kapitalisiert komplett kleingeschriebene Namen", () => {
    expect(formatPersonName("daniel fischer")).toBe("Daniel Fischer");
    expect(formatPersonName("tobias keller")).toBe("Tobias Keller");
  });

  it("kapitalisiert komplett großgeschriebene Namen", () => {
    expect(formatPersonName("MAX MUSTERMANN")).toBe("Max Mustermann");
  });

  it("lässt gemischte Schreibweisen unangetastet", () => {
    expect(formatPersonName("Ronald McDonald")).toBe("Ronald McDonald");
    expect(formatPersonName("Anna deVries")).toBe("Anna deVries");
  });

  it("hält Namens-Partikel mitten im Namen klein", () => {
    expect(formatPersonName("klaus von der heide")).toBe("Klaus von der Heide");
    expect(formatPersonName("jan van dijk")).toBe("Jan van Dijk");
  });

  it("kapitalisiert Partikel am Namensanfang", () => {
    expect(formatPersonName("von der heide")).toBe("Von der Heide");
  });

  it("behandelt Bindestrich- und Apostroph-Namen", () => {
    expect(formatPersonName("anna-lena meier")).toBe("Anna-Lena Meier");
    expect(formatPersonName("patrick o'brien")).toBe("Patrick O'Brien");
  });

  it("behandelt Umlaute korrekt", () => {
    expect(formatPersonName("özge yılmaz")).toBe("Özge Yılmaz");
    expect(formatPersonName("änne müller")).toBe("Änne Müller");
  });

  it("trimmt und kollabiert Whitespace", () => {
    expect(formatPersonName("  daniel   fischer ")).toBe("Daniel Fischer");
    expect(formatPersonName("")).toBe("");
    expect(formatPersonName(null)).toBe("");
    expect(formatPersonName(undefined)).toBe("");
  });
});

describe("formatCompanyName", () => {
  it("normalisiert Rechtsform-Kürzel", () => {
    expect(formatCompanyName("muster gmbh")).toBe("Muster GmbH");
    expect(formatCompanyName("beispiel ug")).toBe("Beispiel UG");
    expect(formatCompanyName("verein e.v.")).toBe("Verein e.V.");
  });

  it("lässt Großschreibung (Marken) und korrekte Firmen unangetastet", () => {
    expect(formatCompanyName("VIDEOCOMET GmbH")).toBe("VIDEOCOMET GmbH");
    expect(formatCompanyName("EDEKA markt nord")).toBe("EDEKA Markt Nord");
  });

  it("kapitalisiert kleingeschriebene Firmennamen", () => {
    expect(formatCompanyName("ems studios berlin")).toBe("Ems Studios Berlin");
  });
});
