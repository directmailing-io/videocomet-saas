import { describe, expect, it } from "vitest";
import {
  computeQrPlacement,
  findAnchorBoxesWithFallbacks,
  type PageWords,
} from "./pdf-qr-overlay";

const GAP = 6;

function page(
  words: PageWords["words"],
  size: { w?: number; h?: number } = {},
): PageWords {
  return { widthPt: size.w ?? 595, heightPt: size.h ?? 842, words };
}

function word(xMin: number, yMin: number, xMax: number, yMax: number, text = "x") {
  return { xMin, yMin, xMax, yMax, text };
}

describe("computeQrPlacement", () => {
  const qr = { qrWidthPt: 100, qrHeightPt: 100 };

  it("nutzt die Marker-Position 1:1, wenn nichts kollidiert", () => {
    const p = page([word(100, 480, 300, 494, "video.digispace.at/max-muster")]);
    const res = computeQrPlacement({
      page: p,
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: { pageIndex: 0, xMin: 100, yMin: 480, xMax: 300, yMax: 494 },
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.x).toBe(120);
    expect(res.yTop).toBe(500);
    expect(res.shiftedDownPt).toBe(0);
    expect(res.w).toBe(100);
  });

  it("schiebt den QR unter eine minimal hineinragende Link-Zeile (Screenshot-Fall)", () => {
    // Link-Zeile ragt 4pt in die QR-Oberkante hinein.
    const link = word(100, 490, 300, 504, "video.digispace.at/margit-varsek");
    const res = computeQrPlacement({
      page: page([link]),
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: { pageIndex: 0, ...link },
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.yTop).toBe(504 + GAP);
    expect(res.shiftedDownPt).toBeCloseTo(10);
  });

  it("lässt eine Caption unter dem QR unangetastet (kein Ein-Kanten-Shift)", () => {
    // Caption liegt komplett UNTER dem QR — die alte Logik (anchor.yMax + gap
    // > yTop) hätte hier fälschlich verschoben.
    const caption = word(120, 610, 220, 624, "video.digispace.at/max");
    const res = computeQrPlacement({
      page: page([caption]),
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: { pageIndex: 0, ...caption },
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.yTop).toBe(500);
    expect(res.shiftedDownPt).toBe(0);
  });

  it("ignoriert Text neben dem QR (kein horizontaler Overlap)", () => {
    const beside = word(300, 520, 500, 534, "daneben");
    const res = computeQrPlacement({
      page: page([beside]),
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: null,
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.yTop).toBe(500);
    expect(res.shiftedDownPt).toBe(0);
  });

  it("toleriert Sub-Punkt-Überschneidungen (Koordinaten-Rauschen)", () => {
    const touching = word(100, 490, 300, 501, "knapp");
    const res = computeQrPlacement({
      page: page([touching]),
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: null,
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.shiftedDownPt).toBe(0);
  });

  it("löst mehrzeilige Kollisionen iterativ (umgebrochene URL)", () => {
    const line1 = word(100, 495, 280, 509, "video.digispace.at/");
    const line2 = word(100, 512, 260, 526, "margit-varsek-a8fe");
    const res = computeQrPlacement({
      page: page([line1, line2]),
      marker: { pageIndex: 0, xMin: 120, yMin: 500, xMax: 220, yMax: 600 },
      anchor: { pageIndex: 0, ...line1 },
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    // Beide Zeilen kollidieren → unter die tiefste (line2).
    expect(res.yTop).toBe(526 + GAP);
  });

  it("fällt ohne Marker auf Anker-Unterkante + fallbackX zurück", () => {
    const link = word(100, 480, 300, 494, "video.digispace.at/max");
    const res = computeQrPlacement({
      page: page([link]),
      marker: null,
      anchor: { pageIndex: 0, ...link },
      ...qr,
      fallbackXPt: 90,
      gapPt: GAP,
    });
    expect(res.x).toBe(90);
    expect(res.yTop).toBe(494 + GAP);
  });

  it("zentriert ohne Marker und fallbackX horizontal unter dem Anker", () => {
    const link = word(100, 480, 300, 494, "video.digispace.at/max");
    const res = computeQrPlacement({
      page: page([link]),
      marker: null,
      anchor: { pageIndex: 0, ...link },
      ...qr,
      fallbackXPt: null,
      gapPt: GAP,
    });
    expect(res.x).toBe(200 - 50);
  });

  it("verkleinert am Seitenende statt rauszulaufen", () => {
    const link = word(100, 790, 300, 804, "video.digispace.at/max");
    const res = computeQrPlacement({
      page: page([link]),
      marker: null,
      anchor: { pageIndex: 0, ...link },
      ...qr,
      fallbackXPt: 100,
      gapPt: GAP,
    });
    expect(res.yTop + res.h).toBeLessThanOrEqual(842 - 12 + 0.001);
    expect(res.h).toBeGreaterThanOrEqual(50); // MIN_SCALE 0.5
    expect(res.w).toBe(res.h);
  });
});

describe("findAnchorBoxesWithFallbacks", () => {
  it("findet den Slug als Wort-Substring", () => {
    const pages = [
      page([word(100, 480, 300, 494, "video.digispace.at/margit-varsek-a8fe")]),
    ];
    const hits = findAnchorBoxesWithFallbacks(pages, ["margit-varsek-a8fe"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].yMin).toBe(480);
  });

  it("greift auf den Hostname-Fallback zurück, wenn der Slug umbricht", () => {
    const pages = [
      page([
        word(100, 480, 280, 494, "video.digispace.at/margit-"),
        word(100, 497, 240, 511, "varsek-a8fe"),
      ]),
    ];
    const hits = findAnchorBoxesWithFallbacks(pages, [
      "margit-varsek-a8fe",
      "video.digispace.at",
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].yMin).toBe(480);
  });

  it("matcht in Runs zerfallene Links über die Zeilen-Konkatenation", () => {
    const pages = [
      page([
        word(100, 480, 200, 494, "video.digispace"),
        word(200, 480, 320, 494, ".at/max-muster"),
      ]),
    ];
    const hits = findAnchorBoxesWithFallbacks(pages, ["video.digispace.at/max-muster"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].xMax).toBe(320);
  });

  it("liefert leer, wenn nichts passt", () => {
    const pages = [page([word(0, 0, 10, 10, "hallo")])];
    expect(findAnchorBoxesWithFallbacks(pages, ["nix", ""])).toHaveLength(0);
  });
});
