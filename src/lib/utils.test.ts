import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/utils";

describe("slugify", () => {
  it("transliteriert deutsche Umlaute (Müller GmbH)", () => {
    expect(slugify("Müller GmbH")).toMatch(/^mueller-gmbh-[a-f0-9]{4}$/);
  });

  it("transliteriert französische Akzente (Café Crème)", () => {
    expect(slugify("Café Crème")).toMatch(/^cafe-creme-[a-f0-9]{4}$/);
  });

  it("transliteriert ß und Umlaute (Weiß & Söhne)", () => {
    expect(slugify("Weiß & Söhne")).toMatch(/^weiss-soehne-[a-f0-9]{4}$/);
  });

  it("entfernt Klammern und Sonderzeichen (Anna Östermann (CEO))", () => {
    expect(slugify("Anna Östermann (CEO)")).toMatch(
      /^anna-oestermann-ceo-[a-f0-9]{4}$/,
    );
  });

  it("normalisiert Bindestriche und Punkte (Hans-Jürgen GmbH & Co. KG)", () => {
    expect(slugify("Hans-Jürgen GmbH & Co. KG")).toMatch(
      /^hans-juergen-gmbh-co-kg-[a-f0-9]{4}$/,
    );
  });

  it("trimmt Whitespace", () => {
    expect(slugify("  Whitespace  ")).toMatch(/^whitespace-[a-f0-9]{4}$/);
  });

  it("verarbeitet leeren String", () => {
    const result = slugify("");
    // Akzeptiere entweder /^-[a-f0-9]{4}$/ ODER reine 4-Hex
    expect(result).toMatch(/^(-?[a-f0-9]{4})$/);
  });

  it("kürzt sehr lange Eingaben auf max 81 Zeichen (76 + - + 4 hex)", () => {
    const long = "a".repeat(200);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(81);
    expect(result).toMatch(/^a{76}-[a-f0-9]{4}$/);
  });

  it("erzeugt keinen Suffix wenn randomSuffix=false", () => {
    expect(slugify("Müller GmbH", false)).toBe("mueller-gmbh");
    expect(slugify("Café Crème", false)).toBe("cafe-creme");
    expect(slugify("Hans-Jürgen GmbH & Co. KG", false)).toBe(
      "hans-juergen-gmbh-co-kg",
    );
  });
});
