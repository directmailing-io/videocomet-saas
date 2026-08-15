import { describe, expect, it } from "vitest";

import {
  DOC_PAGE_GAP_PX,
  DOC_PAGE_WIDTH_PX,
  DOC_VIEWER_HEIGHT_PX,
  DOC_VIEWER_WIDTH_PX,
  GDOCS_TOOLBAR_HEIGHT_PX,
  PDF_TOOLBAR_HEIGHT_PX,
  docStackLayout,
  docToolbarHeightPx,
} from "./doc-geometry";

// A4-Hochformat (Breite/Höhe) — der häufigste Fall.
const A4 = 1 / Math.SQRT2;

describe("doc-geometry — Parität mit der Worker-Referenz (1280×720)", () => {
  it("Referenzkonstanten entsprechen dem Worker-HTML", () => {
    expect(DOC_VIEWER_WIDTH_PX).toBe(1280);
    expect(DOC_VIEWER_HEIGHT_PX).toBe(720);
    expect(DOC_PAGE_WIDTH_PX).toBe(826); // 850 − 2×12
    expect(DOC_PAGE_GAP_PX).toBe(24);
    expect(GDOCS_TOOLBAR_HEIGHT_PX).toBe(160);
    expect(PDF_TOOLBAR_HEIGHT_PX).toBe(56);
    expect(docToolbarHeightPx("gdocs")).toBe(160);
    expect(docToolbarHeightPx("pdf")).toBe(56);
  });

  it("GDocs: viewport = 720−160, maxScroll = Stapel − viewport", () => {
    const n = 3;
    const layout = docStackLayout({
      stageWidth: 1280,
      stageHeight: 720,
      pageAspect: A4,
      pageCount: n,
      variant: "gdocs",
    });
    const pageH = 826 / A4;
    expect(layout.scale).toBe(1);
    expect(layout.pageWidthPx).toBe(826);
    expect(layout.pageHeightPx).toBeCloseTo(pageH, 6);
    expect(layout.viewportPx).toBe(720 - 160);
    expect(layout.stackPx).toBeCloseTo(n * pageH + (n - 1) * 24, 6);
    expect(layout.maxScrollPx).toBeCloseTo(layout.stackPx - 560, 6);
  });

  it("PDF: viewport = 720−56 (Drive-Toolbar)", () => {
    const layout = docStackLayout({
      stageWidth: 1280,
      stageHeight: 720,
      pageAspect: A4,
      pageCount: 2,
      variant: "pdf",
    });
    expect(layout.toolbarPx).toBe(56);
    expect(layout.viewportPx).toBe(720 - 56);
  });

  it("einseitiges Dokument, das in den Viewport passt: maxScroll = 0", () => {
    const layout = docStackLayout({
      stageWidth: 1280,
      stageHeight: 720,
      pageAspect: 16 / 9, // Querformat-Folie, sehr flach
      pageCount: 1,
      variant: "pdf",
    });
    expect(layout.stackPx).toBeLessThan(layout.viewportPx);
    expect(layout.maxScrollPx).toBe(0);
  });

  it("pageCount 0 / stageWidth 0: keine NaN, alles 0", () => {
    const empty = docStackLayout({
      stageWidth: 1280,
      stageHeight: 720,
      pageAspect: A4,
      pageCount: 0,
      variant: "gdocs",
    });
    expect(empty.stackPx).toBe(0);
    expect(empty.maxScrollPx).toBe(0);

    const zeroStage = docStackLayout({
      stageWidth: 0,
      stageHeight: 0,
      pageAspect: A4,
      pageCount: 3,
      variant: "gdocs",
    });
    expect(zeroStage.scale).toBe(0);
    expect(Number.isNaN(zeroStage.maxScrollPx)).toBe(false);
  });
});

describe("doc-geometry — Skalierungs-Invarianz", () => {
  it("halbe 16:9-Bühne → exakt halbe Pixelwerte (Ratio bleibt 1:1)", () => {
    const full = docStackLayout({
      stageWidth: 1280,
      stageHeight: 720,
      pageAspect: A4,
      pageCount: 4,
      variant: "gdocs",
    });
    const half = docStackLayout({
      stageWidth: 640,
      stageHeight: 360,
      pageAspect: A4,
      pageCount: 4,
      variant: "gdocs",
    });
    expect(half.pageWidthPx).toBeCloseTo(full.pageWidthPx / 2, 6);
    expect(half.pageHeightPx).toBeCloseTo(full.pageHeightPx / 2, 6);
    expect(half.gapPx).toBeCloseTo(full.gapPx / 2, 6);
    expect(half.toolbarPx).toBeCloseTo(full.toolbarPx / 2, 6);
    expect(half.viewportPx).toBeCloseTo(full.viewportPx / 2, 6);
    expect(half.maxScrollPx).toBeCloseTo(full.maxScrollPx / 2, 6);
  });

  it("gleiche Ratio zeigt bei jeder Bühnengröße denselben Inhalt", () => {
    // Sichtbarer Dokument-Anteil (in Seitenhöhen) am oberen Viewport-Rand
    // muss über Bühnengrößen konstant sein.
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const positions = [1280, 960, 512].map((w) => {
        const layout = docStackLayout({
          stageWidth: w,
          stageHeight: (w * 9) / 16,
          pageAspect: A4,
          pageCount: 3,
          variant: "pdf",
        });
        // Scroll-Offset relativ zur Seitenhöhe — geräteunabhängige Einheit.
        return (ratio * layout.maxScrollPx) / layout.pageHeightPx;
      });
      expect(positions[1]).toBeCloseTo(positions[0], 6);
      expect(positions[2]).toBeCloseTo(positions[0], 6);
    }
  });
});
