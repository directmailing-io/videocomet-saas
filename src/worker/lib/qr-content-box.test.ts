import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  analyzeQrPlaceholderArtwork,
  buildWysiwygQrPng,
  computeWysiwygQrRect,
} from "./qr-content-box";

/** Weißes Canvas mit schwarzen Rechtecken (x, y, w, h in px). */
async function makeArtwork(
  width: number,
  height: number,
  blackRects: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<Buffer> {
  const rects = blackRects
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="black"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("analyzeQrPlaceholderArtwork", () => {
  it("findet die Content-Box eines QR-Artworks mit weißem Rand", async () => {
    // 200×200, QR-Grafik bei 40..140 (100×100)
    const artwork = await makeArtwork(200, 200, [{ x: 40, y: 40, w: 100, h: 100 }]);
    const box = await analyzeQrPlaceholderArtwork(artwork);
    expect(box).not.toBeNull();
    expect(box!.left).toBeCloseTo(0.2, 1);
    expect(box!.top).toBeCloseTo(0.2, 1);
    expect(box!.width).toBeCloseTo(0.5, 1);
    expect(box!.height).toBeCloseTo(0.5, 1);
  });

  it("Label unter dem QR verlängert die Content-Box nach unten", async () => {
    const artwork = await makeArtwork(200, 200, [
      { x: 40, y: 30, w: 100, h: 100 }, // QR
      { x: 70, y: 145, w: 40, h: 12 }, // "QR-Code"-Label
    ]);
    const box = await analyzeQrPlaceholderArtwork(artwork);
    expect(box).not.toBeNull();
    expect(box!.left).toBeCloseTo(0.2, 1);
    expect(box!.top).toBeCloseTo(0.15, 1);
    expect(box!.width).toBeCloseTo(0.5, 1);
    // Höhe reicht bis zur Label-Unterkante (157/200 - 30/200 ≈ 0.635)
    expect(box!.height).toBeGreaterThan(0.6);
  });

  it("heller Deko-Rahmen (Lavendel) zählt nicht als Content", async () => {
    // Nachbau von Daniels Vorlage: Lavendel-Rahmen um die volle Box,
    // QR mittig — der Weiß-Trim-Ansatz scheiterte an den nicht-weißen Ecken.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="0" y="0" width="200" height="200" fill="none" stroke="#aa8cf5" stroke-width="4"/><rect x="50" y="50" width="100" height="100" fill="black"/></svg>`;
    const artwork = await sharp(Buffer.from(svg)).png().toBuffer();
    const box = await analyzeQrPlaceholderArtwork(artwork);
    expect(box).not.toBeNull();
    expect(box!.left).toBeCloseTo(0.25, 1);
    expect(box!.top).toBeCloseTo(0.25, 1);
    expect(box!.width).toBeCloseTo(0.5, 1);
    expect(box!.height).toBeCloseTo(0.5, 1);
  });

  it("liefert null für randlose Artworks (Full-Box-QR)", async () => {
    const artwork = await makeArtwork(200, 200, [{ x: 0, y: 0, w: 200, h: 200 }]);
    expect(await analyzeQrPlaceholderArtwork(artwork)).toBeNull();
  });

  it("liefert null für komplett weiße oder kaputte Bilder", async () => {
    const blank = await makeArtwork(200, 200, []);
    expect(await analyzeQrPlaceholderArtwork(blank)).toBeNull();
    expect(await analyzeQrPlaceholderArtwork(Buffer.from("kein bild"))).toBeNull();
  });
});

describe("computeWysiwygQrRect", () => {
  it("nimmt das größte Quadrat oben links in der Content-Box (pt-Raum)", () => {
    const rect = computeWysiwygQrRect(
      { left: 0.2, top: 0.1, width: 0.5, height: 0.7 },
      100,
      100,
    );
    expect(rect.leftPt).toBe(20);
    expect(rect.topPt).toBe(10);
    expect(rect.sidePt).toBe(50); // min(50, 70) → Label-Bereich bleibt frei
  });

  it("rechnet im pt-Raum, nicht im Pixel-Raum (verzerrte Platzhalter-Box)", () => {
    // Box 200×50pt: width-ratio 0.5 → 100pt, height-ratio 0.8 → 40pt
    const rect = computeWysiwygQrRect(
      { left: 0, top: 0, width: 0.5, height: 0.8 },
      200,
      50,
    );
    expect(rect.sidePt).toBe(40);
  });
});

describe("buildWysiwygQrPng", () => {
  it("platziert den QR an der Artwork-Position auf weißem Grund", async () => {
    const qr = await makeArtwork(100, 100, [{ x: 0, y: 0, w: 100, h: 100 }]);
    const out = await buildWysiwygQrPng({
      qrPng: qr,
      ratios: { left: 0.2, top: 0.2, width: 0.5, height: 0.5 },
      boxWidthPt: 100,
      boxHeightPt: 100,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(1000);
    const raw = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) =>
      raw.data[(y * raw.info.width + x) * raw.info.channels];
    expect(px(50, 50)).toBe(255); // Rand: weiß
    expect(px(450, 450)).toBe(0); // Content-Box-Mitte: QR (schwarz)
    expect(px(950, 950)).toBe(255); // unter der Content-Box: weiß
  });
});
