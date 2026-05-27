import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

/**
 * Mockt Math.random so, dass slugify einen bestimmten 4-Hex-Suffix erzeugt.
 *
 * slugify nutzt:
 *   Math.random().toString(16).slice(2, 6)
 *
 * Beispiel: mockRandomHex("dead") → slugify(...) endet auf "-dead".
 */
export function mockRandomHex(hex: string): void {
  if (!/^[a-f0-9]{4}$/i.test(hex)) {
    throw new Error(`mockRandomHex erwartet exakt 4 hex Zeichen, bekam: ${hex}`);
  }
  // Math.random().toString(16) liefert z.B. "0.abcdef12345...". Wir steuern slice(2,6).
  // Trick: wir liefern eine Zahl, deren hex-Darstellung "0." + hex + ... ist.
  // Einfacher: monkeypatch toString temporär nicht. Stattdessen geben wir die
  // gewünschte 4-Hex zurück, indem wir eine Zahl konstruieren, die nach
  // .toString(16) exakt "0.<hex>..." liefert. parseInt(hex, 16) / 16^4 ergibt
  // einen Bruch, dessen Hex-Darstellung mit diesen 4 Ziffern beginnt.
  const value = parseInt(hex, 16) / 0x10000;
  if (randomSpy) randomSpy.mockRestore();
  randomSpy = vi.spyOn(Math, "random").mockReturnValue(value);
}

afterEach(() => {
  if (randomSpy) {
    randomSpy.mockRestore();
    randomSpy = null;
  }
  vi.restoreAllMocks();
});
