import { describe, expect, it } from "vitest";
import { checkFirstName } from "./intro-name-check";

describe("checkFirstName", () => {
  describe("valid German names", () => {
    it.each([
      ["Jürgen", "Jürgen"],
      ["Özlem", "Özlem"],
      ["André", "André"],
      ["Anna-Lena", "Anna-Lena"],
      ["sabine", "Sabine"],
      ["  Karl  ", "Karl"],
    ])("accepts %s → %s", (input, expected) => {
      const res = checkFirstName(input);
      expect(res).toEqual({ ok: true, name: expected });
    });

    it("keeps double first names when both tokens are valid (max 2)", () => {
      expect(checkFirstName("Anna Maria")).toEqual({
        ok: true,
        name: "Anna Maria",
      });
      // Drittes Token wird verworfen.
      expect(checkFirstName("Anna Maria Luise")).toEqual({
        ok: true,
        name: "Anna Maria",
      });
    });

    it("drops an invalid second token but keeps the first", () => {
      expect(checkFirstName("Anna GmbH")).toEqual({ ok: true, name: "Anna" });
      expect(checkFirstName("Peter 123")).toEqual({ ok: true, name: "Peter" });
    });

    it("strips leading titles and salutations", () => {
      expect(checkFirstName("Herr Jürgen")).toEqual({
        ok: true,
        name: "Jürgen",
      });
      expect(checkFirstName("Frau Dr. Özlem")).toEqual({
        ok: true,
        name: "Özlem",
      });
      expect(checkFirstName("Dr. Anna")).toEqual({ ok: true, name: "Anna" });
      expect(checkFirstName("Prof. Dr. med. Hans")).toEqual({
        ok: true,
        name: "Hans",
      });
      expect(checkFirstName("Dipl.-Ing. Markus")).toEqual({
        ok: true,
        name: "Markus",
      });
    });

    it("normalizes only the first letter, keeps the rest as given", () => {
      expect(checkFirstName("aNNA")).toEqual({ ok: true, name: "ANNA" });
    });
  });

  describe("invalid inputs", () => {
    it("rejects empty and whitespace-only input", () => {
      expect(checkFirstName("").ok).toBe(false);
      expect(checkFirstName("   ").ok).toBe(false);
      expect(checkFirstName("\t\n").ok).toBe(false);
    });

    it("rejects blocklisted company/department values", () => {
      for (const bad of [
        "GmbH",
        "gmbh",
        "AG",
        "Firma",
        "Team",
        "info",
        "Kontakt",
        "Vertrieb",
        "Buchhaltung",
        "Familie",
      ]) {
        expect(checkFirstName(bad).ok, bad).toBe(false);
      }
    });

    it("rejects e-mail addresses", () => {
      expect(checkFirstName("info@x.de").ok).toBe(false);
      expect(checkFirstName("max.mustermann@firma.de").ok).toBe(false);
    });

    it("rejects digits", () => {
      expect(checkFirstName("123").ok).toBe(false);
      expect(checkFirstName("4711").ok).toBe(false);
    });

    it("rejects a lone title", () => {
      expect(checkFirstName("Dr.").ok).toBe(false);
      expect(checkFirstName("Herr").ok).toBe(false);
      expect(checkFirstName("Herr Dr.").ok).toBe(false);
    });

    it("rejects single-character and overlong tokens", () => {
      expect(checkFirstName("A").ok).toBe(false);
      expect(checkFirstName("A".repeat(30)).ok).toBe(false);
    });
  });
});
