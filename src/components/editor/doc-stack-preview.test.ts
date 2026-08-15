import { describe, expect, it } from "vitest";
import { perPageHeightFromStackHeight } from "./doc-stack-preview";

describe("perPageHeightFromStackHeight", () => {
  it("einseitiges Dokument: Stapelhöhe = Seitenhöhe", () => {
    expect(perPageHeightFromStackHeight(1100, 1)).toBe(1100);
  });

  it("mehrseitig: zieht die 24px-Gaps ab und teilt durch die Seitenzahl", () => {
    // 3 Seiten à 1100px + 2 Gaps à 24px = 3348
    expect(perPageHeightFromStackHeight(3 * 1100 + 2 * 24, 3)).toBe(1100);
  });

  it("0 Seiten oder fehlende Höhe → 0 (Fallback-Aspect greift)", () => {
    expect(perPageHeightFromStackHeight(1100, 0)).toBe(0);
    expect(perPageHeightFromStackHeight(0, 3)).toBe(0);
  });
});
