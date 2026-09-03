import { describe, expect, it } from "vitest";
import {
  WatchAccumulator,
  capSegments,
  coveragePct,
  coverageSeconds,
  mergeSegments,
  normalizeProgressPayload,
  sanitizeProgressPayload,
} from "./watch-coverage";

describe("watch-coverage", () => {
  it("vereinigt überlappende Intervalle", () => {
    expect(mergeSegments([[0, 5], [3, 8], [10, 12], [12, 14]])).toEqual([[0, 8], [10, 14]]);
    expect(coverageSeconds([[0, 5], [3, 8]])).toBe(8);
  });

  it("10 % schauen, vorspulen, 10 % schauen = 20 %", () => {
    const acc = new WatchAccumulator();
    // 100 s Video, 0..10 s in 0,5-s-Ticks
    for (let t = 0; t <= 10; t += 0.5) acc.tick(t);
    acc.seek();
    for (let t = 60; t <= 70; t += 0.5) acc.tick(t);
    const s = acc.snapshot(100);
    expect(s.playedSec).toBe(20);
    expect(s.coveragePct).toBe(20);
    expect(s.segments).toEqual([[0, 10], [60, 70]]);
    expect(s.maxSec).toBe(70);
  });

  it("erkennt Sprünge auch ohne seek-Event", () => {
    const acc = new WatchAccumulator();
    for (let t = 0; t <= 5; t += 0.25) acc.tick(t);
    acc.tick(50); // Sprung
    for (let t = 50.25; t <= 55; t += 0.25) acc.tick(t);
    const s = acc.snapshot(100);
    expect(s.playedSec).toBe(10);
    expect(s.coveragePct).toBe(10);
  });

  it("zweimal dieselbe Stelle zählt nicht doppelt", () => {
    const acc = new WatchAccumulator();
    for (let t = 0; t <= 20; t += 1) acc.tick(t);
    acc.seek();
    for (let t = 0; t <= 20; t += 1) acc.tick(t);
    expect(acc.snapshot(40).coveragePct).toBe(50);
  });

  it("ended zählt bis zur Länge", () => {
    const acc = new WatchAccumulator();
    for (let t = 0; t <= 58; t += 1) acc.tick(t);
    acc.ended(60);
    expect(acc.snapshot(60).coveragePct).toBe(100);
  });

  it("begrenzt die Segmentzahl", () => {
    const many: Array<[number, number]> = [];
    for (let i = 0; i < 120; i++) many.push([i * 10, i * 10 + 2]);
    expect(capSegments(many, 40).length).toBeLessThanOrEqual(40);
    expect(coveragePct(many, 1200)).toBe(20);
  });

  it("normalisiert alte Bridge-Payloads (atSec/duration)", () => {
    const n = normalizeProgressPayload({ atSec: 45, duration: 90 });
    expect(n.durationSec).toBe(90);
    expect(n.playedSec).toBe(45);
    expect(n.coveragePct).toBe(50);
  });

  it("normalisiert neue Payloads und bevorzugt Segmente", () => {
    const n = normalizeProgressPayload({ atSec: 80, durationSec: 100, segments: [[0, 10], [60, 70]] });
    expect(n.playedSec).toBe(20);
    expect(n.coveragePct).toBe(20);
  });

  it("sanitize verwirft Müll", () => {
    const out = sanitizeProgressPayload({ atSec: -5, durationSec: 99999, playedSec: "abc", segments: [[1, 0], ["x", 2], [0, 4]], foo: "bar" });
    expect(out.atSec).toBeUndefined();
    expect(out.durationSec).toBe(7200);
    expect(out.segments).toEqual([[0, 4]]);
    expect(out).not.toHaveProperty("foo");
  });
});
