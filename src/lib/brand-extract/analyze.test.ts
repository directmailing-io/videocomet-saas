/**
 * Tests für die reine Brand-Extraktions-Auswertung (analyze.ts) —
 * synthetisches Roh-JSON, kein Puppeteer.
 */

import { describe, expect, it } from "vitest";

import {
  analyzeExtraction,
  detectBgMode,
  isEmptyExtraction,
  mapRadius,
  mapShadow,
  parseCssColor,
  pickBrandColors,
  sortLogoCandidates,
  type RawButtonStyle,
  type RawExtraction,
  type RawLogoCandidate,
} from "./analyze";

function button(overrides: Partial<RawButtonStyle> = {}): RawButtonStyle {
  return {
    backgroundColor: "rgb(37, 99, 235)",
    color: "rgb(255, 255, 255)",
    borderRadius: "8px",
    boxShadow: "none",
    ...overrides,
  };
}

function rawExtraction(overrides: Partial<RawExtraction> = {}): RawExtraction {
  return {
    buttons: [button(), button(), button()],
    backgrounds: ["rgb(255, 255, 255)"],
    headingFontFamily: "Inter, sans-serif",
    bodyFontFamily: "Inter, sans-serif",
    logoCandidates: [],
    textLength: 2000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseCssColor
// ---------------------------------------------------------------------------

describe("parseCssColor", () => {
  it("parst rgb() aus computed styles zu hex", () => {
    expect(parseCssColor("rgb(37, 99, 235)")).toBe("#2563eb");
    expect(parseCssColor("rgb(0, 0, 0)")).toBe("#000000");
  });

  it("parst rgba() mit voller Deckkraft", () => {
    expect(parseCssColor("rgba(255, 87, 34, 1)")).toBe("#ff5722");
  });

  it("verwirft transparente und halbtransparente Werte", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseCssColor("rgba(37, 99, 235, 0.3)")).toBeNull();
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("inherit")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });

  it("akzeptiert hex-Eingaben inkl. Kurzform", () => {
    expect(parseCssColor("#2563eb")).toBe("#2563eb");
    expect(parseCssColor("#fff")).toBe("#ffffff");
  });

  it("verwirft nicht parsebare Werte", () => {
    expect(parseCssColor("hsl(220, 90%, 50%)")).toBeNull();
    expect(parseCssColor("kaputt")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickBrandColors — Primärfarben-Clustering
// ---------------------------------------------------------------------------

describe("pickBrandColors", () => {
  it("Grau/Weiß/Schwarz fliegen raus, häufigste gesättigte Farbe gewinnt", () => {
    const { primary } = pickBrandColors([
      "rgb(255, 255, 255)", // weiß
      "rgb(255, 255, 255)",
      "rgb(238, 238, 238)", // hellgrau
      "rgb(17, 17, 17)", // fast schwarz
      "rgb(37, 99, 235)", // blau ×2 → gewinnt
      "rgb(37, 99, 235)",
    ]);
    expect(primary).toBe("#2563eb");
  });

  it("clustert nahe Farbtöne in einen Bucket", () => {
    // Drei sehr ähnliche Blautöne + zwei identische Rottöne — der
    // Blau-Bucket ist in Summe häufiger.
    const { primary } = pickBrandColors([
      "rgb(37, 99, 235)",
      "rgb(40, 100, 235)",
      "rgb(37, 99, 235)",
      "rgb(220, 38, 38)",
      "rgb(220, 38, 38)",
    ]);
    expect(primary).toBe("#2563eb");
  });

  it("Akzent = zweithäufigste Farbe mit Hue-Abstand > 30 Grad", () => {
    const { primary, accent } = pickBrandColors([
      "rgb(37, 99, 235)", // blau (~224°) ×3
      "rgb(37, 99, 235)",
      "rgb(37, 99, 235)",
      "rgb(249, 115, 22)", // orange (~25°) ×2
      "rgb(249, 115, 22)",
    ]);
    expect(primary).toBe("#2563eb");
    expect(accent).toBe("#f97316");
  });

  it("kein Akzent, wenn der Hue-Abstand zu klein ist", () => {
    const { accent } = pickBrandColors([
      "rgb(37, 99, 235)", // ~224°
      "rgb(37, 99, 235)",
      "rgb(37, 99, 235)",
      "rgb(56, 189, 248)", // hellblau ~199° → < 30° Abstand
      "rgb(56, 189, 248)",
    ]);
    expect(accent).toBeNull();
  });

  it("ein einzelner Farbtupfer wird nicht zum Akzent (min. 2 Vorkommen)", () => {
    const { accent } = pickBrandColors([
      "rgb(37, 99, 235)",
      "rgb(37, 99, 235)",
      "rgb(249, 115, 22)", // nur 1× → Rauschen
    ]);
    expect(accent).toBeNull();
  });

  it("liefert null ohne gesättigte Kandidaten", () => {
    const { primary, accent } = pickBrandColors([
      "rgb(255, 255, 255)",
      "rgb(17, 17, 17)",
      "transparent",
    ]);
    expect(primary).toBeNull();
    expect(accent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapRadius — Median-Mapping
// ---------------------------------------------------------------------------

describe("mapRadius", () => {
  it("0px → none", () => {
    expect(mapRadius(["0px", "0px", "0px"])).toBe("none");
  });

  it("6px → subtle", () => {
    expect(mapRadius(["6px", "6px", "6px"])).toBe("subtle");
  });

  it("12px → soft", () => {
    expect(mapRadius(["12px", "12px", "12px"])).toBe("soft");
  });

  it("9999px-Pille → round", () => {
    expect(mapRadius(["9999px", "9999px", "9999px"])).toBe("round");
  });

  it("50% zählt als Pille", () => {
    expect(mapRadius(["50%", "50%", "50%"])).toBe("round");
  });

  it("nutzt den Median, nicht Ausreißer", () => {
    // Median von [0, 0, 9999] = 0 → none.
    expect(mapRadius(["0px", "0px", "9999px"])).toBe("none");
    // Median von [6, 12, 12] = 12 → soft.
    expect(mapRadius(["6px", "12px", "12px"])).toBe("soft");
  });

  it("ohne parsebare Werte → subtle (Default)", () => {
    expect(mapRadius([])).toBe("subtle");
    expect(mapRadius(["kaputt"])).toBe("subtle");
  });
});

// ---------------------------------------------------------------------------
// mapShadow — Stufen + Blur-Intensität
// ---------------------------------------------------------------------------

describe("mapShadow", () => {
  const NONE = "none";
  const SOFT_SHADOW = "rgba(0, 0, 0, 0.08) 0px 1px 4px 0px";
  const BOLD_SHADOW = "rgba(0, 0, 0, 0.25) 0px 8px 24px 0px";

  it("unter 10 Prozent Schatten-Anteil → flat", () => {
    expect(mapShadow([NONE, NONE, NONE, NONE])).toBe("flat");
  });

  it("mittlerer Anteil → soft", () => {
    expect(mapShadow([BOLD_SHADOW, NONE, NONE, NONE])).toBe("soft"); // 25 %
  });

  it("hoher Anteil + großer Blur → bold", () => {
    expect(mapShadow([BOLD_SHADOW, BOLD_SHADOW, BOLD_SHADOW, NONE])).toBe(
      "bold",
    );
  });

  it("hoher Anteil, aber dezenter Blur → bleibt soft", () => {
    expect(mapShadow([SOFT_SHADOW, SOFT_SHADOW, SOFT_SHADOW, SOFT_SHADOW])).toBe(
      "soft",
    );
  });

  it("ohne Elemente → soft (neutraler Default)", () => {
    expect(mapShadow([])).toBe("soft");
  });
});

// ---------------------------------------------------------------------------
// detectBgMode — hell/dunkel
// ---------------------------------------------------------------------------

describe("detectBgMode", () => {
  it("weiße Flächen → light", () => {
    expect(detectBgMode(["rgb(255, 255, 255)", "rgb(248, 250, 252)"])).toBe(
      "light",
    );
  });

  it("dunkle Mehrheit → dark", () => {
    expect(
      detectBgMode([
        "rgb(11, 12, 16)",
        "rgb(21, 23, 28)",
        "rgb(255, 255, 255)",
      ]),
    ).toBe("dark");
  });

  it("nicht parsebare Werte werden ignoriert, Default light", () => {
    expect(detectBgMode(["transparent", "kaputt"])).toBe("light");
    expect(detectBgMode([])).toBe("light");
  });
});

// ---------------------------------------------------------------------------
// sortLogoCandidates — Dedupe + Reihenfolge
// ---------------------------------------------------------------------------

describe("sortLogoCandidates", () => {
  it("sortiert svg/header-img vor og vor icon", () => {
    const input: RawLogoCandidate[] = [
      { url: "https://x.de/favicon.ico", kind: "icon", width: 32, height: 32 },
      { url: "https://x.de/og.png", kind: "og" },
      { url: "https://x.de/logo.png", kind: "header-img", width: 200, height: 60 },
      { url: "https://x.de/logo.svg", kind: "svg", width: 180, height: 40 },
    ];
    const sorted = sortLogoCandidates(input);
    expect(sorted.map((c) => c.kind)).toEqual([
      "svg",
      "header-img",
      "og",
      "icon",
    ]);
  });

  it("größere Bilder zuerst innerhalb eines Kinds, ohne Maße ans Ende", () => {
    const sorted = sortLogoCandidates([
      { url: "https://x.de/a.png", kind: "header-img" },
      { url: "https://x.de/b.png", kind: "header-img", width: 400, height: 100 },
      { url: "https://x.de/c.png", kind: "header-img", width: 100, height: 40 },
    ]);
    expect(sorted.map((c) => c.url)).toEqual([
      "https://x.de/b.png",
      "https://x.de/c.png",
      "https://x.de/a.png",
    ]);
  });

  it("dedupliziert per URL — besserer kind-Rang gewinnt", () => {
    const sorted = sortLogoCandidates([
      { url: "https://x.de/logo.svg", kind: "icon" },
      { url: "https://x.de/logo.svg", kind: "svg", width: 200, height: 50 },
    ]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].kind).toBe("svg");
  });

  it("liefert maximal 6 Kandidaten", () => {
    const many: RawLogoCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      many.push({ url: `https://x.de/logo-${i}.png`, kind: "header-img" });
    }
    expect(sortLogoCandidates(many)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// isEmptyExtraction
// ---------------------------------------------------------------------------

describe("isEmptyExtraction", () => {
  it("erkennt leere Seiten / Blocker-Interstitials", () => {
    expect(
      isEmptyExtraction(
        rawExtraction({ buttons: [], logoCandidates: [], textLength: 5 }),
      ),
    ).toBe(true);
  });

  it("normale Seiten sind nicht leer", () => {
    expect(isEmptyExtraction(rawExtraction())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzeExtraction — Gesamtbild
// ---------------------------------------------------------------------------

describe("analyzeExtraction", () => {
  it("baut ein vollständiges Kit aus einer typischen hellen Seite", () => {
    const raw = rawExtraction({
      buttons: [
        button({ boxShadow: "rgba(0, 0, 0, 0.2) 0px 8px 24px 0px" }),
        button({ boxShadow: "rgba(0, 0, 0, 0.2) 0px 8px 24px 0px" }),
        button(),
      ],
      logoCandidates: [
        { url: "https://kunde.de/logo.svg", kind: "svg", width: 180, height: 40 },
        { url: "https://kunde.de/favicon.ico", kind: "icon", width: 32, height: 32 },
      ],
    });
    const { kit, logoCandidates } = analyzeExtraction(raw, "https://kunde.de");

    expect(kit.colors.primary).toBe("#2563eb");
    expect(kit.colors.bg).toBe("light");
    expect(kit.colors.accent).toBeUndefined();
    expect(kit.fontPairId).toBe("inter");
    expect(kit.radius).toBe("subtle");
    expect(kit.shadow).toBe("bold");
    expect(kit.sourceUrl).toBe("https://kunde.de");
    expect(kit.logo).toBeUndefined();
    expect(logoCandidates[0].kind).toBe("svg");
  });

  it("erkennt dunkle Seiten und hellt unlesbare Primärfarben auf", () => {
    const raw = rawExtraction({
      backgrounds: ["rgb(11, 12, 16)", "rgb(11, 12, 16)"],
      // Sehr dunkles Blau — auf fast-schwarzem Grund unlesbar.
      buttons: [
        button({ backgroundColor: "rgb(10, 20, 60)" }),
        button({ backgroundColor: "rgb(10, 20, 60)" }),
      ],
    });
    const { kit } = analyzeExtraction(raw, "https://dark.de");

    expect(kit.colors.bg).toBe("dark");
    // ensureReadablePrimary muss aufgehellt haben — nicht die Rohfarbe.
    expect(kit.colors.primary).not.toBe("#0a143c");
  });

  it("Serifen-Headline → Serif-Font-Paar", () => {
    const raw = rawExtraction({
      headingFontFamily: 'Georgia, "Times New Roman", serif',
    });
    const { kit } = analyzeExtraction(raw, "https://kunde.de");
    expect(kit.fontPairId).toBe("playfair-source");
  });

  it("achromatische Marke: schwarze Buttons werden Primärfarbe", () => {
    const raw = rawExtraction({
      buttons: [
        button({ backgroundColor: "rgb(17, 17, 17)" }),
        button({ backgroundColor: "rgb(17, 17, 17)" }),
        button({ backgroundColor: "rgb(255, 255, 255)" }),
      ],
    });
    const { kit } = analyzeExtraction(raw, "https://mono.de");
    expect(kit.colors.primary).toBe("#111111");
  });

  it("Akzentfarbe landet im Kit, wenn sie klar getrennt ist", () => {
    const raw = rawExtraction({
      buttons: [
        button(),
        button(),
        button(),
        button({ backgroundColor: "rgb(249, 115, 22)" }),
        button({ backgroundColor: "rgb(249, 115, 22)" }),
      ],
    });
    const { kit } = analyzeExtraction(raw, "https://kunde.de");
    expect(kit.colors.accent).toBe("#f97316");
  });
});
