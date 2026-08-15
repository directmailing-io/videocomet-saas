import { describe, expect, it } from "vitest";
import { interpolateCursorPos } from "./cursor-overlay";
import type { CursorFrame } from "./types";

const frames: CursorFrame[] = [
  { t: 1000, x: 0.2, y: 0.4 },
  { t: 2000, x: 0.6, y: 0.8 },
];

describe("interpolateCursorPos", () => {
  it("ist unsichtbar vor dem ersten Sample", () => {
    expect(interpolateCursorPos(frames, 0)).toBeNull();
    expect(interpolateCursorPos(frames, 999)).toBeNull();
    expect(interpolateCursorPos(undefined, 500)).toBeNull();
    expect(interpolateCursorPos([], 500)).toBeNull();
  });

  it("interpoliert linear zwischen Samples", () => {
    const pos = interpolateCursorPos(frames, 1500);
    expect(pos?.x).toBeCloseTo(0.4);
    expect(pos?.y).toBeCloseTo(0.6);
  });

  it("hält die letzte Position nach dem letzten Sample", () => {
    expect(interpolateCursorPos(frames, 2000)).toEqual({ x: 0.6, y: 0.8 });
    expect(interpolateCursorPos(frames, 99_000)).toEqual({ x: 0.6, y: 0.8 });
  });

  it("liefert exakt das Sample am Sample-Zeitpunkt", () => {
    const pos = interpolateCursorPos(frames, 1000);
    expect(pos?.x).toBeCloseTo(0.2);
    expect(pos?.y).toBeCloseTo(0.4);
  });

  it("klemmt Werte auf 0..1", () => {
    const wild: CursorFrame[] = [
      { t: 0, x: -0.5, y: 1.5 },
      { t: 1000, x: 2, y: -1 },
    ];
    expect(interpolateCursorPos(wild, 0)).toEqual({ x: 0, y: 1 });
    expect(interpolateCursorPos(wild, 1000)).toEqual({ x: 1, y: 0 });
  });

  it("sortiert unsortierte Frames vor der Interpolation", () => {
    const unsorted = [frames[1], frames[0]];
    const pos = interpolateCursorPos(unsorted, 1500);
    expect(pos?.x).toBeCloseTo(0.4);
  });
});
