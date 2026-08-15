import { describe, expect, it } from "vitest";

import { buildStarterBlocks } from "./starter-page";

describe("buildStarterBlocks", () => {
  it("liefert die Standard-Reihenfolge Hero → Content → Rezensionen → FAQ → CTA", () => {
    const blocks = buildStarterBlocks();
    expect(blocks.map((b) => b.type)).toEqual([
      "hero",
      "rich-text",
      "testimonials",
      "faq",
      "cta-banner",
    ]);
  });

  it("erzeugt pro Aufruf frische, eindeutige IDs", () => {
    const a = buildStarterBlocks();
    const b = buildStarterBlocks();
    const ids = [...a, ...b].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Hero zeigt das Video zentriert und nutzt den Vorname-Platzhalter", () => {
    const hero = buildStarterBlocks()[0]!;
    expect(hero.data.showVideo).toBe(true);
    expect(hero.data.alignment).toBe("center");
    expect(String(hero.data.headline)).toContain("{{vorname|");
  });

  it("Testimonials und FAQ sind vorbefüllt (kein leerer Editor)", () => {
    const blocks = buildStarterBlocks();
    const testi = blocks.find((b) => b.type === "testimonials")!;
    const faq = blocks.find((b) => b.type === "faq")!;
    expect((testi.data.items as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((faq.data.items as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});
