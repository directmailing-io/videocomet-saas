import { describe, expect, it } from "vitest";
import { normalizeUrlInput, urlInputError } from "./url-input";

describe("normalizeUrlInput", () => {
  it("stellt https:// voran, wenn kein Protokoll da ist", () => {
    expect(normalizeUrlInput("firma.de")).toBe("https://firma.de");
    expect(normalizeUrlInput("  http://firma.de ")).toBe("http://firma.de");
    expect(normalizeUrlInput("")).toBe("");
  });
});

describe("urlInputError", () => {
  it("akzeptiert vollständige Adressen", () => {
    expect(urlInputError("firma.de")).toBeNull();
    expect(urlInputError("https://www.firma.de/karriere")).toBeNull();
    expect(urlInputError("docs.google.com/document/d/abc")).toBeNull();
  });

  it("lehnt Hosts ohne Punkt + Endung ab (Daniels videocomet-Fall)", () => {
    expect(urlInputError("videocomet")).toBe(
      "Bitte gib eine vollständige Adresse ein, zum Beispiel firma.de",
    );
    expect(urlInputError("firma.1")).not.toBeNull();
    expect(urlInputError("")).not.toBeNull();
    expect(urlInputError("   ")).not.toBeNull();
  });
});
