/**
 * Tests für `src/lib/webhooks/quartile.ts`. Deckt die 4 Schwellwerte,
 * die Edge-Cases (≤0 duration, negative played) und die >100%-
 * Übersteuerung ab.
 */
import { describe, expect, it } from "vitest";
import { progressToQuartile } from "@/lib/webhooks/quartile";

describe("webhooks/quartile", () => {
  it("< 25% → null", () => {
    expect(progressToQuartile(10, 60)).toBeNull(); // 16.6%
    expect(progressToQuartile(0, 60)).toBeNull();
  });

  it("≥ 25% → 25", () => {
    expect(progressToQuartile(15, 60)).toBe(25);
    expect(progressToQuartile(29, 60)).toBe(25);
  });

  it("≥ 50% → 50", () => {
    expect(progressToQuartile(30, 60)).toBe(50);
    expect(progressToQuartile(44, 60)).toBe(50);
  });

  it("≥ 75% → 75", () => {
    expect(progressToQuartile(45, 60)).toBe(75);
    expect(progressToQuartile(59, 60)).toBe(75);
  });

  it("= 100% oder > → 100", () => {
    expect(progressToQuartile(60, 60)).toBe(100);
    expect(progressToQuartile(80, 60)).toBe(100); // Hairline-Übersteuerung
  });

  it("durationSec ≤ 0 → null (keine Division durch 0)", () => {
    expect(progressToQuartile(10, 0)).toBeNull();
    expect(progressToQuartile(10, -5)).toBeNull();
  });

  it("playedSec < 0 → null (defensiv)", () => {
    expect(progressToQuartile(-1, 60)).toBeNull();
  });

  it("non-finite Inputs → null", () => {
    expect(progressToQuartile(NaN, 60)).toBeNull();
    expect(progressToQuartile(10, Infinity)).toBeNull();
  });
});
