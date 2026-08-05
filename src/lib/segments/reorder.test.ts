import { describe, expect, it } from "vitest";
import { computeReorderTargetIndex, type BlockPos } from "./reorder";

const blocks: BlockPos[] = [
  { id: "a", leftPx: 0, widthPx: 100 },
  { id: "b", leftPx: 100, widthPx: 100 },
  { id: "c", leftPx: 200, widthPx: 100 },
  { id: "d", leftPx: 300, widthPx: 100 },
];

describe("computeReorderTargetIndex", () => {
  it("returnt gleichen Index, wenn Zeiger im aktuellen Segment bleibt", () => {
    // dragging 'b' und Zeiger bei 150 (Center von 'b') → bleibt Index 1
    expect(computeReorderTargetIndex(blocks, "b", 150)).toBe(1);
  });

  it("verschiebt nach rechts, wenn Zeiger über spätere Center", () => {
    // dragging 'a' und Zeiger bei 250 (Center von 'c') → Ziel-Index 2
    // (nach Entfernen von 'a' wird 'c' zu Index 1, davor einfügen = 1;
    // die Funktion gibt post-splice-Index zurück)
    expect(computeReorderTargetIndex(blocks, "a", 260)).toBe(2);
  });

  it("verschiebt nach links, wenn Zeiger vor früherem Center", () => {
    // dragging 'd' und Zeiger bei 40 (vor Center von 'a') → 0
    expect(computeReorderTargetIndex(blocks, "d", 40)).toBe(0);
  });

  it("Zeiger vor dem allerersten Block → 0", () => {
    expect(computeReorderTargetIndex(blocks, "c", -50)).toBe(0);
  });

  it("Zeiger hinter dem letzten Block → letzter Index", () => {
    expect(computeReorderTargetIndex(blocks, "a", 999)).toBe(
      blocks.length - 1,
    );
  });

  it("unbekannte ID → -1 (no-op)", () => {
    expect(computeReorderTargetIndex(blocks, "x", 100)).toBe(-1);
  });
});
