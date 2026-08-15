import { describe, expect, it } from "vitest";

import { buildStarterBlocks } from "./starter-page";

describe("buildStarterBlocks", () => {
  it("liefert genau eine fertige Hero-Sektion (Hero-first-Einstieg)", () => {
    const blocks = buildStarterBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["hero"]);
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
});
