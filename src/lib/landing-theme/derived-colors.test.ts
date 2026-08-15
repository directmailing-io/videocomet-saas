import { describe, expect, it } from "vitest";

import {
  borderTone,
  contrastRatio,
  deriveDarkColors,
  derivedSurfaces,
  ensureReadablePrimary,
  hoverTone,
  modeFromBackground,
  onColor,
  softTone,
} from "@/lib/landing-theme/derived-colors";

const HEX = /^#[0-9a-f]{6}$/;

describe("onColor", () => {
  it("liefert weiß auf kräftigem Blau (#2563eb)", () => {
    const on = onColor("#2563eb");
    expect(on).toBe("#ffffff");
    expect(contrastRatio(on, "#2563eb")).toBeGreaterThanOrEqual(4.5);
  });

  it("liefert fast-schwarz auf Gelb (#facc15) — nicht weiß!", () => {
    const on = onColor("#facc15");
    expect(on).not.toBe("#ffffff");
    expect(contrastRatio(on, "#facc15")).toBeGreaterThanOrEqual(4.5);
  });

  it("fällt bei nicht parsebarer Eingabe auf weiß zurück", () => {
    expect(onColor("rebeccapurple")).toBe("#ffffff");
  });
});

describe("softTone", () => {
  it("light: sehr helle Tönung, heller als die Primärfarbe", () => {
    const soft = softTone("#2563eb", "light");
    expect(soft).toMatch(HEX);
    // heller als primary → mehr Kontrast zu Schwarz als zu Weiß
    expect(contrastRatio(soft, "#000000")).toBeGreaterThan(
      contrastRatio("#2563eb", "#000000"),
    );
    // fast weiß: sehr wenig Kontrast zu reinem Weiß
    expect(contrastRatio(soft, "#ffffff")).toBeLessThan(1.3);
  });

  it("dark: sehr dunkle Tönung", () => {
    const soft = softTone("#2563eb", "dark");
    expect(soft).toMatch(HEX);
    expect(contrastRatio(soft, "#000000")).toBeLessThan(2);
  });
});

describe("hoverTone", () => {
  it("light: dunkelt leicht ab", () => {
    const hover = hoverTone("#2563eb", "light");
    expect(hover).toMatch(HEX);
    expect(contrastRatio(hover, "#ffffff")).toBeGreaterThan(
      contrastRatio("#2563eb", "#ffffff"),
    );
  });

  it("dark: hellt leicht auf", () => {
    const hover = hoverTone("#2563eb", "dark");
    expect(hover).toMatch(HEX);
    expect(contrastRatio(hover, "#000000")).toBeGreaterThan(
      contrastRatio("#2563eb", "#000000"),
    );
  });
});

describe("borderTone", () => {
  it("light: dezent dunkler als der Hintergrund", () => {
    const border = borderTone("#ffffff", "light");
    expect(border).toMatch(HEX);
    const ratio = contrastRatio(border, "#ffffff");
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(2);
  });

  it("dark: dezent heller als der Hintergrund", () => {
    const border = borderTone("#0b0c10", "dark");
    expect(border).toMatch(HEX);
    expect(contrastRatio(border, "#0b0c10")).toBeGreaterThan(1.05);
  });
});

describe("modeFromBackground", () => {
  it("erkennt dunkle Hintergründe", () => {
    expect(modeFromBackground("#0a0a0a")).toBe("dark");
    expect(modeFromBackground("#171717")).toBe("dark");
  });

  it("erkennt helle Hintergründe", () => {
    expect(modeFromBackground("#ffffff")).toBe("light");
    expect(modeFromBackground("#fef3c7")).toBe("light");
  });

  it("fällt bei Nicht-Hex auf light zurück", () => {
    expect(modeFromBackground("linear-gradient(red, blue)")).toBe("light");
  });
});

describe("derivedSurfaces / deriveDarkColors", () => {
  it("dark: dunkler bg, hellere surface, heller Text", () => {
    const s = derivedSurfaces("dark");
    expect(modeFromBackground(s.bg)).toBe("dark");
    expect(contrastRatio(s.surface, "#000000")).toBeGreaterThan(
      contrastRatio(s.bg, "#000000"),
    );
    expect(contrastRatio(s.text, s.bg)).toBeGreaterThanOrEqual(7);
  });

  it("deriveDarkColors liefert vollständige ThemeColors mit Akzent-Fallback", () => {
    const colors = deriveDarkColors("#a78bfa");
    expect(colors.primary).toBe("#a78bfa");
    expect(colors.accent).toBe("#a78bfa");
    expect(modeFromBackground(colors.bg)).toBe("dark");
  });
});

describe("ensureReadablePrimary", () => {
  it("dunkelt Neon-Gelb auf weißem Grund ab", () => {
    const result = ensureReadablePrimary("#facc15", "#ffffff");
    expect(result.original).toBe("#facc15");
    expect(result.usable).not.toBe("#facc15");
    expect(contrastRatio(result.usable, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("lässt kräftiges Blau auf weißem Grund unverändert", () => {
    const result = ensureReadablePrimary("#2563eb", "#ffffff");
    expect(result.usable).toBe("#2563eb");
    expect(result.original).toBe("#2563eb");
  });

  it("hellt zu dunkle Primärfarben auf dunklem Grund auf", () => {
    const result = ensureReadablePrimary("#1a1a2e", "#0b0c10");
    expect(result.usable).not.toBe("#1a1a2e");
    expect(contrastRatio(result.usable, "#0b0c10")).toBeGreaterThanOrEqual(3);
  });

  it("gibt nicht parsebare Eingaben unverändert zurück", () => {
    const result = ensureReadablePrimary("hsl(200 80% 50%)", "#ffffff");
    expect(result.usable).toBe("hsl(200 80% 50%)");
  });
});
