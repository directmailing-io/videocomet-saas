/**
 * Generate demo assets for VideoComet's marketing-page interactive demo.
 *
 * Produces:
 *   public/demo-assets/website-screenshot.png  (1200 x 8000)
 *   public/demo-assets/slide-1.png             (1920 x 1080)
 *   public/demo-assets/slide-2.png             (1920 x 1080)
 *   public/demo-assets/slide-3.png             (1920 x 1080)
 *   public/demo-assets/slide-4.png             (1920 x 1080)
 *   public/demo-assets/slide-5.png             (1920 x 1080)
 *
 * Usage: npx tsx scripts/generate-demo-assets.ts
 */

import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  brandPurple: "#AA8CF5",
  brandDeep: "#7c5ce8",
  brandSoft: "#f3eeff",
  textDark: "#0F172A",
  textMuted: "#64748B",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  // helpers used by fake website chrome
  footerDark: "#0F172A",
  chromeGrey: "#F1F5F9",
  greyMedium: "#CBD5E1",
  greyLight: "#F8FAFC",
  // Industrie-Webseite-Accents (bunter Stil)
  industrieNavy: "#0C2F5C",
  industrieOrange: "#FF6B35",
  industrieOrangeLight: "#FFA177",
  industrieTeal: "#00B4A6",
  industrieTealLight: "#5FE0D5",
  industrieYellow: "#FBBF24",
  industrieYellowSoft: "#FEF3C7",
  industrieBeige: "#FDF6EC",
  industrieCoral: "#F87171",
  industrieMint: "#D1FAE5",
  industrieSlateBlue: "#475569",
  industrieSkyLight: "#DBEAFE",
} as const;

const FONT_FAMILY = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

// Escape text for safe inclusion in SVG.
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Shared SVG fragments
// ---------------------------------------------------------------------------

function slideHeaderLogo(): string {
  // top-left "VIDEOCOMET" wordmark
  return `
    <g transform="translate(80, 70)">
      <rect x="0" y="-22" width="14" height="14" rx="3" fill="${COLORS.brandPurple}" />
      <rect x="18" y="-22" width="14" height="14" rx="3" fill="${COLORS.brandDeep}" />
      <text x="42" y="-10" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="18" letter-spacing="2.5" fill="${COLORS.textDark}">VIDEOCOMET</text>
    </g>
  `;
}

function slideFooterPageNumber(current: number, total: number): string {
  return `
    <g transform="translate(1840, 1030)">
      <text text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500"
            font-size="20" fill="${COLORS.textMuted}">${current}/${total}</text>
    </g>
  `;
}

function slideBackground(): string {
  // subtle radial of brand-soft so all slides share a feel
  return `
    <defs>
      <radialGradient id="slideBg" cx="20%" cy="0%" r="90%">
        <stop offset="0%" stop-color="${COLORS.brandSoft}" stop-opacity="1"/>
        <stop offset="55%" stop-color="${COLORS.surface}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${COLORS.surface}" stop-opacity="1"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#slideBg)" />
    <!-- decorative top accent bar -->
    <rect x="0" y="0" width="1920" height="6" fill="${COLORS.brandPurple}" />
  `;
}

// ---------------------------------------------------------------------------
// Slide 1 — Personalisierte Titelfolie "Video für Max Mustermann"
// ---------------------------------------------------------------------------

function buildSlide1(): string {
  // Stilisierter Kunde-Avatar (Initialen) + Begruessung
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="s1Bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${COLORS.brandSoft}" />
        <stop offset="100%" stop-color="${COLORS.surface}" />
      </linearGradient>
      <linearGradient id="s1Avatar" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${COLORS.brandPurple}" />
        <stop offset="100%" stop-color="${COLORS.brandDeep}" />
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#s1Bg)" />
    <rect x="0" y="0" width="1920" height="6" fill="${COLORS.brandPurple}" />
    ${slideHeaderLogo()}

    <!-- decorative dots -->
    <circle cx="200" cy="900" r="60" fill="${COLORS.industrieOrange}" opacity="0.18" />
    <circle cx="1750" cy="200" r="80" fill="${COLORS.industrieTeal}" opacity="0.18" />
    <rect x="1640" y="800" width="80" height="80" rx="16" fill="${COLORS.industrieYellow}" opacity="0.4" />

    <!-- Avatar + Name -->
    <g transform="translate(220, 360)">
      <circle cx="100" cy="100" r="100" fill="url(#s1Avatar)" />
      <text x="100" y="120" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="700" font-size="72" fill="${COLORS.surface}">MM</text>
    </g>

    <!-- Hauptueberschrift -->
    <text x="460" y="430" font-family="${FONT_FAMILY}" font-weight="600"
          font-size="32" fill="${COLORS.brandDeep}" letter-spacing="3">PERSÖNLICHES VIDEO</text>
    <text x="460" y="540" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="92" fill="${COLORS.textDark}">Video für</text>
    <text x="460" y="640" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="92" fill="${COLORS.brandDeep}">Max Mustermann</text>

    <!-- Untertitel -->
    <text x="460" y="730" font-family="${FONT_FAMILY}" font-weight="400"
          font-size="32" fill="${COLORS.textMuted}">Mustermann Industrie GmbH · München</text>

    <!-- Slide-Footer -->
    <rect x="220" y="900" width="1480" height="2" fill="${COLORS.border}" />
    <text x="220" y="970" font-family="${FONT_FAMILY}" font-weight="500"
          font-size="22" fill="${COLORS.textMuted}">5 Minuten · Vertraulich · Mustermann Industrie GmbH</text>

    ${slideFooterPageNumber(1, 5)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Slide 2 — Vorher: 1 Lead pro Tag
// ---------------------------------------------------------------------------

function buildSlide2(): string {
  // 5 short bars, brand-soft grey color
  const barHeights = [38, 30, 44, 34, 40];
  const chartLeft = 1100;
  const baseline = 720;
  const barWidth = 90;
  const barGap = 50;

  const bars = barHeights
    .map((h, i) => {
      const x = chartLeft + i * (barWidth + barGap);
      const y = baseline - h;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="6" fill="${COLORS.greyMedium}" />`;
    })
    .join("");

  // axis line
  const axisLeft = chartLeft - 40;
  const axisRight = chartLeft + barHeights.length * (barWidth + barGap);

  // Slide 2: Ihre Situation — schmerzpunkte als grosse Zahlen
  const painPoints = [
    { number: "73 %", text: "Standardvideos werden übersprungen" },
    { number: "2,4 ×", text: "längere Vertriebszyklen ohne Persönlichkeit" },
    { number: "< 5 %", text: "Konversionsrate bei Kalt-E-Mails" },
  ];
  const painItems = painPoints
    .map((p, i) => {
      const y = 460 + i * 160;
      return `
        <g transform="translate(220, ${y})">
          <text x="0" y="0" font-family="${FONT_FAMILY}" font-weight="800"
                font-size="78" fill="${COLORS.industrieOrange}">${esc(p.number)}</text>
          <text x="380" y="-12" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="36" fill="${COLORS.textDark}">${esc(p.text)}</text>
          <line x1="380" y1="14" x2="1700" y2="14" stroke="${COLORS.border}" stroke-width="2" />
        </g>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    ${slideBackground()}
    ${slideHeaderLogo()}
    <text x="220" y="280" font-family="${FONT_FAMILY}" font-weight="600"
          font-size="28" fill="${COLORS.brandDeep}" letter-spacing="3">IHRE SITUATION</text>
    <text x="220" y="380" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="76" fill="${COLORS.textDark}">Was uns auffällt …</text>
    ${painItems}
    ${slideFooterPageNumber(2, 5)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Slide 3 — Nachher: 50 Leads pro Tag
// ---------------------------------------------------------------------------

function buildSlide3(): string {
  // Same layout but bars 10x taller, in brand purple
  const barHeights = [380, 300, 440, 340, 400];
  const chartLeft = 1100;
  const baseline = 920;
  const barWidth = 90;
  const barGap = 50;

  const bars = barHeights
    .map((h, i) => {
      const x = chartLeft + i * (barWidth + barGap);
      const y = baseline - h;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="6" fill="${COLORS.brandPurple}" />`;
    })
    .join("");

  const axisLeft = chartLeft - 40;
  const axisRight = chartLeft + barHeights.length * (barWidth + barGap);

  // Slide 3: Wachstumskurve "vorher vs. nachher"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    ${slideBackground()}
    ${slideHeaderLogo()}
    <text x="220" y="280" font-family="${FONT_FAMILY}" font-weight="600"
          font-size="28" fill="${COLORS.brandDeep}" letter-spacing="3">UNSER VORSCHLAG</text>
    <text x="220" y="380" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="76" fill="${COLORS.textDark}">Ihre Zahlen in 90 Tagen</text>

    <!-- Kurve: vorher (orange flach) vs. nachher (purple steigend) -->
    <g transform="translate(220, 470)">
      <!-- axes -->
      <line x1="60" y1="500" x2="1480" y2="500" stroke="${COLORS.textMuted}" stroke-width="2" />
      <line x1="60" y1="40" x2="60" y2="500" stroke="${COLORS.textMuted}" stroke-width="2" />

      <!-- y-grid -->
      <line x1="60" y1="380" x2="1480" y2="380" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="6,8" />
      <line x1="60" y1="260" x2="1480" y2="260" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="6,8" />
      <line x1="60" y1="140" x2="1480" y2="140" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="6,8" />

      <!-- y-axis labels -->
      <text x="40" y="500" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500" font-size="20" fill="${COLORS.textMuted}">0</text>
      <text x="40" y="385" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500" font-size="20" fill="${COLORS.textMuted}">25</text>
      <text x="40" y="265" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500" font-size="20" fill="${COLORS.textMuted}">50</text>
      <text x="40" y="145" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500" font-size="20" fill="${COLORS.textMuted}">75</text>

      <!-- Vorher: flat orange -->
      <path d="M 80 480 L 350 478 L 620 482 L 890 479 L 1160 480 L 1440 481"
            fill="none" stroke="${COLORS.industrieOrange}" stroke-width="6" stroke-linecap="round" />
      <text x="1480" y="475" font-family="${FONT_FAMILY}" font-weight="600" font-size="24" fill="${COLORS.industrieOrange}">Vorher</text>

      <!-- Nachher: steigend purple -->
      <path d="M 80 480 L 350 420 L 620 320 L 890 220 L 1160 120 L 1440 60"
            fill="none" stroke="${COLORS.brandPurple}" stroke-width="8" stroke-linecap="round" />
      <text x="1480" y="55" font-family="${FONT_FAMILY}" font-weight="700" font-size="28" fill="${COLORS.brandDeep}">Nachher</text>

      <!-- end point dot -->
      <circle cx="1440" cy="60" r="14" fill="${COLORS.brandDeep}" />
      <circle cx="1440" cy="60" r="6" fill="${COLORS.surface}" />

      <!-- x-axis labels -->
      <text x="80" y="540" font-family="${FONT_FAMILY}" font-weight="500" font-size="22" fill="${COLORS.textMuted}">Tag 0</text>
      <text x="760" y="540" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="500" font-size="22" fill="${COLORS.textMuted}">Tag 45</text>
      <text x="1440" y="540" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="500" font-size="22" fill="${COLORS.textMuted}">Tag 90</text>
    </g>

    ${slideFooterPageNumber(3, 5)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Slide 4 — Über 180 zufriedene Kunden
// ---------------------------------------------------------------------------

function buildSlide4(): string {
  const names = [
    "STUGEBA",
    "NORDIC",
    "PHASE",
    "ACME",
    "DELTA",
    "OMEGA",
    "PRIME",
    "VECTOR",
    "PIXEL",
    "AURA",
    "FORGE",
    "CORE",
  ];

  // 4 columns x 3 rows grid centered horizontally
  const cols = 4;
  const rows = 3;
  const cellW = 320;
  const cellH = 130;
  const gapX = 40;
  const gapY = 30;
  const gridW = cols * cellW + (cols - 1) * gapX;
  const gridH = rows * cellH + (rows - 1) * gapY;
  const gridX = (1920 - gridW) / 2;
  const gridY = 470;

  const cells = names
    .map((name, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = gridX + c * (cellW + gapX);
      const y = gridY + r * (cellH + gapY);
      // alternate accent shapes — circle, square, triangle, bar — for "abstract logo" look
      const shapeKind = idx % 4;
      let shape = "";
      const sx = x + 30;
      const sy = y + cellH / 2;
      if (shapeKind === 0) {
        shape = `<circle cx="${sx + 18}" cy="${sy}" r="22" fill="${COLORS.brandPurple}" />`;
      } else if (shapeKind === 1) {
        shape = `<rect x="${sx}" y="${sy - 22}" width="44" height="44" rx="8" fill="${COLORS.brandDeep}" />`;
      } else if (shapeKind === 2) {
        shape = `<polygon points="${sx + 22},${sy - 24} ${sx + 46},${sy + 22} ${sx - 2},${sy + 22}" fill="${COLORS.brandPurple}" />`;
      } else {
        shape = `
          <rect x="${sx}" y="${sy - 18}" width="14" height="36" rx="3" fill="${COLORS.brandDeep}" />
          <rect x="${sx + 22}" y="${sy - 10}" width="14" height="28" rx="3" fill="${COLORS.brandPurple}" />
        `;
      }
      return `
        <g>
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="14"
                fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="1.5" />
          ${shape}
          <text x="${x + 110}" y="${y + cellH / 2 + 10}" font-family="${FONT_FAMILY}"
                font-weight="700" font-size="32" letter-spacing="2" fill="${COLORS.textDark}">${esc(name)}</text>
        </g>
      `;
    })
    .join("");

  // sanity assert (compile-time hint only)
  void gridH;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    ${slideBackground()}
    ${slideHeaderLogo()}
    <text x="960" y="280" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="600"
          font-size="28" fill="${COLORS.brandDeep}" letter-spacing="3">REFERENZEN AUS IHRER BRANCHE</text>
    <text x="960" y="380" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="64" fill="${COLORS.textDark}">Wer uns bereits vertraut</text>
    ${cells}
    ${slideFooterPageNumber(4, 5)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Slide 5 — Jetzt starten →
// ---------------------------------------------------------------------------

function buildSlide5(): string {
  const buttonW = 480;
  const buttonH = 110;
  const buttonX = (1920 - buttonW) / 2;
  const buttonY = 760;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    ${slideBackground()}
    ${slideHeaderLogo()}

    <text x="960" y="320" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="600"
          font-size="32" fill="${COLORS.brandDeep}" letter-spacing="4">NÄCHSTER SCHRITT</text>

    <text x="960" y="450" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="100" fill="${COLORS.textDark}">Lassen Sie uns sprechen,</text>
    <text x="960" y="560" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="800"
          font-size="100" fill="${COLORS.brandDeep}">Herr Mustermann.</text>

    <text x="960" y="660" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="400"
          font-size="30" fill="${COLORS.textMuted}">30 Minuten · unverbindlich · per Video</text>

    <!-- CTA Button -->
    <g>
      <rect x="${buttonX}" y="${buttonY}" width="${buttonW}" height="${buttonH}" rx="16"
            fill="${COLORS.brandPurple}" />
      <text x="960" y="${buttonY + buttonH / 2 + 16}" text-anchor="middle"
            font-family="${FONT_FAMILY}" font-weight="700" font-size="42" fill="${COLORS.surface}">Termin vereinbaren →</text>
    </g>

    ${slideFooterPageNumber(5, 5)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// website-screenshot.png — 1200 x 8000 fake site
// ---------------------------------------------------------------------------

function buildWebsiteScreenshot(): string {
  const W = 1200;
  const H = 8000;

  // ---- Browser chrome (0 - 80) ----
  const chrome = `
    <g>
      <rect x="0" y="0" width="${W}" height="80" fill="${COLORS.chromeGrey}" />
      <circle cx="32" cy="40" r="9" fill="#FF5F57" />
      <circle cx="60" cy="40" r="9" fill="#FEBC2E" />
      <circle cx="88" cy="40" r="9" fill="#28C840" />
      <rect x="160" y="20" width="900" height="40" rx="20"
            fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="1" />
      <text x="190" y="46" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="18" fill="${COLORS.textMuted}">https://kunden-website.de</text>
    </g>
  `;

  // ---- Header (80 - 200) ----
  const header = `
    <g transform="translate(0, 80)">
      <rect x="0" y="0" width="${W}" height="120" fill="${COLORS.surface}" />
      <rect x="0" y="119" width="${W}" height="1" fill="${COLORS.border}" />
      <!-- logo block -->
      <rect x="60" y="42" width="36" height="36" rx="6" fill="${COLORS.textDark}" />
      <text x="108" y="68" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="22" fill="${COLORS.textDark}">MUSTERMANN GmbH</text>
      <!-- nav -->
      <g font-family="${FONT_FAMILY}" font-weight="500" font-size="16" fill="${COLORS.textDark}">
        <text x="720" y="65">Home</text>
        <text x="800" y="65">Leistungen</text>
        <text x="920" y="65">Über uns</text>
        <text x="1020" y="65">Kontakt</text>
      </g>
    </g>
  `;

  // ---- Hero (200 - 1200) — bunter Industrie-Stil mit Navy-Hintergrund + Orange-Akzent ----
  const hero = `
    <g transform="translate(0, 200)">
      <defs>
        <linearGradient id="heroBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${COLORS.industrieNavy}" />
          <stop offset="100%" stop-color="${COLORS.brandDeep}" />
        </linearGradient>
        <linearGradient id="heroImg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${COLORS.industrieOrangeLight}" />
          <stop offset="100%" stop-color="${COLORS.industrieOrange}" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="1000" fill="url(#heroBg)" />
      <!-- decorative shapes -->
      <circle cx="100" cy="940" r="60" fill="${COLORS.industrieOrange}" opacity="0.7" />
      <rect x="1060" y="80" width="80" height="80" rx="20" fill="${COLORS.industrieTeal}" opacity="0.8" />
      <circle cx="1100" cy="900" r="40" fill="${COLORS.industrieYellow}" opacity="0.9" />

      <!-- left text -->
      <text x="80" y="320" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="20" fill="${COLORS.industrieYellow}" letter-spacing="3">SEIT 1985</text>
      <text x="80" y="410" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="64" fill="${COLORS.surface}">Persönlicher</text>
      <text x="80" y="490" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="64" fill="${COLORS.surface}">Service</text>
      <text x="80" y="570" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="64" fill="${COLORS.industrieOrange}">seit 1985.</text>
      <text x="80" y="650" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="22" fill="${COLORS.surface}" opacity="0.85">Wir betreuen Familien und Unternehmen in der Region</text>
      <text x="80" y="685" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="22" fill="${COLORS.surface}" opacity="0.85">mit handgemachter Beratung und einem festen Ansprechpartner.</text>

      <!-- CTA -->
      <g>
        <rect x="80" y="740" width="280" height="64" rx="12" fill="${COLORS.industrieOrange}" />
        <text x="220" y="780" text-anchor="middle" font-family="${FONT_FAMILY}"
              font-weight="700" font-size="20" fill="${COLORS.surface}">Termin vereinbaren</text>
      </g>
      <g>
        <rect x="380" y="740" width="220" height="64" rx="12"
              fill="transparent" stroke="${COLORS.surface}" stroke-width="2" />
        <text x="490" y="780" text-anchor="middle" font-family="${FONT_FAMILY}"
              font-weight="600" font-size="20" fill="${COLORS.surface}">Mehr erfahren</text>
      </g>

      <!-- right image placeholder mit Orange-Gradient -->
      <rect x="640" y="200" width="500" height="600" rx="20" fill="url(#heroImg)" />
      <circle cx="890" cy="450" r="120" fill="${COLORS.surface}" opacity="0.18" />
      <circle cx="980" cy="560" r="80" fill="${COLORS.industrieYellow}" opacity="0.6" />
      <rect x="700" y="630" width="80" height="80" rx="14" fill="${COLORS.surface}" opacity="0.25" />
    </g>
  `;

  // ---- Features (1200 - 2400) — bunt mit 3 verschiedenen Akzentfarben ----
  const featurePalettes = [
    { tile: COLORS.industrieOrange, soft: "#FFE8DD", title: "Beratung" },
    { tile: COLORS.industrieTeal, soft: "#CCFBF1", title: "Service" },
    { tile: COLORS.industrieYellow, soft: COLORS.industrieYellowSoft, title: "Wartung" },
  ];
  const featuresCards = featurePalettes
    .map((p, i) => {
      const x = 80 + i * 360;
      return `
        <g>
          <rect x="${x}" y="1700" width="320" height="380" rx="16"
                fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="1" />
          <rect x="${x + 32}" y="1732" width="64" height="64" rx="14" fill="${p.soft}" />
          <circle cx="${x + 64}" cy="1764" r="18" fill="${p.tile}" />
          <text x="${x + 32}" y="1850" font-family="${FONT_FAMILY}" font-weight="700"
                font-size="22" fill="${COLORS.textDark}">${p.title}</text>
          <text x="${x + 32}" y="1900" font-family="${FONT_FAMILY}" font-weight="400"
                font-size="16" fill="${COLORS.textMuted}">Persönliche Beratung mit jahre-</text>
          <text x="${x + 32}" y="1924" font-family="${FONT_FAMILY}" font-weight="400"
                font-size="16" fill="${COLORS.textMuted}">langer Erfahrung in unserer Region.</text>
          <text x="${x + 32}" y="2000" font-family="${FONT_FAMILY}" font-weight="600"
                font-size="16" fill="${p.tile}">Mehr →</text>
        </g>
      `;
    })
    .join("");

  const features = `
    <g>
      <rect x="0" y="1200" width="${W}" height="1200" fill="${COLORS.industrieBeige}" />
      <text x="${W / 2}" y="1380" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="600" font-size="18" fill="${COLORS.industrieOrange}" letter-spacing="3">WAS WIR BIETEN</text>
      <text x="${W / 2}" y="1470" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="800" font-size="48" fill="${COLORS.textDark}">Unsere Leistungen</text>
      <text x="${W / 2}" y="1530" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="400" font-size="20" fill="${COLORS.textMuted}">Massgeschneidert für Ihre Anforderungen</text>
      ${featuresCards}
      <!-- decorative -->
      <circle cx="120" cy="2280" r="32" fill="${COLORS.industrieOrange}" opacity="0.6" />
      <rect x="1040" y="2240" width="60" height="60" rx="12" fill="${COLORS.industrieTeal}" opacity="0.5" />
    </g>
  `;

  // ---- Über uns (2400 - 3600) ----
  const aboutUs = `
    <g>
      <rect x="0" y="2400" width="${W}" height="1200" fill="${COLORS.surface}" />
      <text x="80" y="2580" font-family="${FONT_FAMILY}" font-weight="500"
            font-size="18" fill="${COLORS.brandDeep}" letter-spacing="3">ÜBER UNS</text>
      <text x="80" y="2670" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="48" fill="${COLORS.textDark}">40 Jahre Erfahrung,</text>
      <text x="80" y="2730" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="48" fill="${COLORS.textDark}">ein festes Team.</text>
      <text x="80" y="2810" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="${COLORS.textMuted}">Seit 1985 betreuen wir Familien und Unternehmen</text>
      <text x="80" y="2842" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="${COLORS.textMuted}">in der Region und stehen für verlässliche, persön-</text>
      <text x="80" y="2874" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="${COLORS.textMuted}">liche Beratung.</text>

      <text x="80" y="2960" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="${COLORS.brandDeep}">• Inhabergeführt seit drei Generationen</text>
      <text x="80" y="2996" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="${COLORS.brandDeep}">• Fester Ansprechpartner für jeden Kunden</text>
      <text x="80" y="3032" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="${COLORS.brandDeep}">• Regional verwurzelt, digital aufgestellt</text>

      <!-- team placeholder -->
      <defs>
        <linearGradient id="teamImg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${COLORS.brandSoft}" />
          <stop offset="100%" stop-color="${COLORS.greyLight}" />
        </linearGradient>
      </defs>
      <rect x="640" y="2540" width="500" height="900" rx="20" fill="url(#teamImg)"
            stroke="${COLORS.border}" stroke-width="1" />
      <circle cx="760" cy="2780" r="56" fill="${COLORS.greyMedium}" />
      <circle cx="890" cy="2780" r="56" fill="${COLORS.greyMedium}" />
      <circle cx="1020" cy="2780" r="56" fill="${COLORS.greyMedium}" />
      <rect x="700" y="2890" width="380" height="14" rx="6" fill="${COLORS.greyMedium}" />
      <rect x="730" y="2920" width="320" height="10" rx="5" fill="${COLORS.border}" />
    </g>
  `;

  // ---- Testimonials (3600 - 4800) ----
  const testimonialCards = [0, 1, 2]
    .map((i) => {
      const x = 80 + i * 360;
      return `
        <g>
          <rect x="${x}" y="4040" width="320" height="420" rx="16"
                fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="1" />
          <text x="${x + 32}" y="4108" font-family="${FONT_FAMILY}" font-weight="800"
                font-size="48" fill="${COLORS.brandPurple}">“</text>
          <text x="${x + 32}" y="4180" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="18" fill="${COLORS.textDark}">Sehr persönliche Betreuung,</text>
          <text x="${x + 32}" y="4208" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="18" fill="${COLORS.textDark}">schnelle Reaktionszeit und</text>
          <text x="${x + 32}" y="4236" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="18" fill="${COLORS.textDark}">ehrliche Beratung.</text>
          <!-- author -->
          <circle cx="${x + 56}" cy="4340" r="22" fill="${COLORS.brandSoft}" />
          <text x="${x + 92}" y="4338" font-family="${FONT_FAMILY}" font-weight="700"
                font-size="16" fill="${COLORS.textDark}">Kunde ${i + 1}</text>
          <text x="${x + 92}" y="4360" font-family="${FONT_FAMILY}" font-weight="400"
                font-size="14" fill="${COLORS.textMuted}">Geschäftsführung</text>
        </g>
      `;
    })
    .join("");

  const testimonials = `
    <g>
      <rect x="0" y="3600" width="${W}" height="1200" fill="${COLORS.industrieYellowSoft}" />
      <text x="${W / 2}" y="3780" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="600" font-size="18" fill="${COLORS.industrieOrange}" letter-spacing="3">REFERENZEN</text>
      <text x="${W / 2}" y="3870" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="800" font-size="48" fill="${COLORS.textDark}">Was unsere Kunden sagen</text>
      <circle cx="80" cy="4720" r="50" fill="${COLORS.industrieYellow}" opacity="0.7" />
      <rect x="1040" y="4680" width="70" height="70" rx="14" fill="${COLORS.industrieTeal}" opacity="0.6" />
      ${testimonialCards}
    </g>
  `;

  // ---- Statistics (4800 - 5600) ----
  const stats = [
    { big: "180+", small: "Kunden" },
    { big: "40", small: "Jahre" },
    { big: "98%", small: "Empfehlungsrate" },
    { big: "24/7", small: "Service" },
  ];
  const statColors = [COLORS.industrieOrange, COLORS.industrieTeal, COLORS.industrieYellow, COLORS.brandPurple];
  const statBlocks = stats
    .map((s, i) => {
      const x = 80 + i * 270;
      return `
        <g>
          <text x="${x + 110}" y="5230" text-anchor="middle" font-family="${FONT_FAMILY}"
                font-weight="800" font-size="60" fill="${statColors[i]}">${s.big}</text>
          <text x="${x + 110}" y="5280" text-anchor="middle" font-family="${FONT_FAMILY}"
                font-weight="500" font-size="18" fill="${COLORS.surface}" opacity="0.85">${s.small}</text>
        </g>
      `;
    })
    .join("");

  const statistics = `
    <g>
      <rect x="0" y="4800" width="${W}" height="800" fill="${COLORS.industrieNavy}" />
      <text x="${W / 2}" y="5020" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="600" font-size="18" fill="${COLORS.industrieYellow}" letter-spacing="3">ZAHLEN, DIE WIR LIEBEN</text>
      <text x="${W / 2}" y="5110" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="800" font-size="40" fill="${COLORS.surface}">In Kürze</text>
      <rect x="80" y="5160" width="1040" height="200" rx="20"
            fill="${COLORS.surface}" opacity="0.07" />
      ${statBlocks}
      <circle cx="60" cy="5460" r="40" fill="${COLORS.industrieOrange}" opacity="0.5" />
      <circle cx="1140" cy="5500" r="50" fill="${COLORS.industrieTeal}" opacity="0.4" />
    </g>
  `;

  // ---- Pricing (5600 - 6800) ----
  const pricingCards = [
    { title: "Basis", price: "29 €", featured: false },
    { title: "Pro", price: "79 €", featured: true },
    { title: "Enterprise", price: "199 €", featured: false },
  ]
    .map((p, i) => {
      const x = 80 + i * 360;
      const stroke = p.featured ? COLORS.brandPurple : COLORS.border;
      const sw = p.featured ? "2.5" : "1";
      return `
        <g>
          <rect x="${x}" y="6080" width="320" height="540" rx="20"
                fill="${COLORS.surface}" stroke="${stroke}" stroke-width="${sw}" />
          ${
            p.featured
              ? `<rect x="${x + 100}" y="6056" width="120" height="36" rx="18" fill="${COLORS.brandPurple}" />
                 <text x="${x + 160}" y="6080" text-anchor="middle" font-family="${FONT_FAMILY}"
                       font-weight="700" font-size="14" fill="${COLORS.surface}">EMPFOHLEN</text>`
              : ""
          }
          <text x="${x + 32}" y="6160" font-family="${FONT_FAMILY}" font-weight="700"
                font-size="22" fill="${COLORS.textDark}">${p.title}</text>
          <text x="${x + 32}" y="6240" font-family="${FONT_FAMILY}" font-weight="800"
                font-size="48" fill="${COLORS.textDark}">${p.price}</text>
          <text x="${x + 32}" y="6272" font-family="${FONT_FAMILY}" font-weight="400"
                font-size="14" fill="${COLORS.textMuted}">pro Monat</text>

          <text x="${x + 32}" y="6340" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="16" fill="${COLORS.textDark}">✓ Persönliche Beratung</text>
          <text x="${x + 32}" y="6376" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="16" fill="${COLORS.textDark}">✓ Monatliche Termine</text>
          <text x="${x + 32}" y="6412" font-family="${FONT_FAMILY}" font-weight="500"
                font-size="16" fill="${COLORS.textDark}">✓ Reporting</text>

          <rect x="${x + 32}" y="6500" width="256" height="56" rx="12"
                fill="${p.featured ? COLORS.brandPurple : COLORS.surface}"
                stroke="${p.featured ? COLORS.brandPurple : COLORS.border}" stroke-width="1.5" />
          <text x="${x + 160}" y="6536" text-anchor="middle" font-family="${FONT_FAMILY}"
                font-weight="700" font-size="16"
                fill="${p.featured ? COLORS.surface : COLORS.textDark}">Auswählen</text>
        </g>
      `;
    })
    .join("");

  const pricing = `
    <g>
      <rect x="0" y="5600" width="${W}" height="1200" fill="${COLORS.greyLight}" />
      <text x="${W / 2}" y="5780" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="500" font-size="18" fill="${COLORS.brandDeep}" letter-spacing="3">PAKETE</text>
      <text x="${W / 2}" y="5870" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="800" font-size="48" fill="${COLORS.textDark}">Pakete</text>
      <text x="${W / 2}" y="5930" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="400" font-size="20" fill="${COLORS.textMuted}">Faire Preise, transparent kalkuliert.</text>
      ${pricingCards}
    </g>
  `;

  // ---- CTA section (6800 - 7600) — Orange-Industrie-Band ----
  const cta = `
    <g>
      <defs>
        <linearGradient id="ctaBg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${COLORS.industrieOrange}" />
          <stop offset="100%" stop-color="${COLORS.industrieCoral}" />
        </linearGradient>
      </defs>
      <rect x="0" y="6800" width="${W}" height="800" fill="${COLORS.surface}" />
      <rect x="80" y="6960" width="1040" height="480" rx="24" fill="url(#ctaBg)" />
      <circle cx="180" cy="7390" r="60" fill="${COLORS.surface}" opacity="0.18" />
      <circle cx="1020" cy="7020" r="40" fill="${COLORS.industrieYellow}" opacity="0.7" />
      <text x="${W / 2}" y="7100" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="600" font-size="18" fill="${COLORS.industrieYellow}" letter-spacing="3">UNVERBINDLICH</text>
      <text x="${W / 2}" y="7200" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="800" font-size="48" fill="${COLORS.surface}">Jetzt unverbindlich anfragen</text>
      <text x="${W / 2}" y="7250" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="400" font-size="20" fill="${COLORS.surface}" opacity="0.9">Antwort innerhalb von 24 Stunden — versprochen.</text>

      <rect x="${(W - 280) / 2}" y="7310" width="280" height="68" rx="14" fill="${COLORS.surface}" />
      <text x="${W / 2}" y="7352" text-anchor="middle" font-family="${FONT_FAMILY}"
            font-weight="700" font-size="20" fill="${COLORS.industrieOrange}">Kontakt aufnehmen</text>
    </g>
  `;

  // ---- Footer (7600 - 8000) ----
  const footer = `
    <g>
      <rect x="0" y="7600" width="${W}" height="400" fill="${COLORS.footerDark}" />

      <!-- column 1: brand + addr -->
      <rect x="80" y="7660" width="32" height="32" rx="6" fill="${COLORS.brandPurple}" />
      <text x="124" y="7684" font-family="${FONT_FAMILY}" font-weight="800"
            font-size="20" fill="${COLORS.surface}">MUSTERMANN GmbH</text>
      <text x="80" y="7740" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">Musterstraße 123</text>
      <text x="80" y="7762" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">12345 Musterstadt</text>
      <text x="80" y="7790" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">+49 30 1234567</text>

      <!-- column 2: legal -->
      <text x="480" y="7684" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="14" fill="${COLORS.surface}">Rechtliches</text>
      <text x="480" y="7724" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">Impressum</text>
      <text x="480" y="7752" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">Datenschutz</text>
      <text x="480" y="7780" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="14" fill="${COLORS.greyMedium}">AGB</text>

      <!-- column 3: social -->
      <text x="820" y="7684" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="14" fill="${COLORS.surface}">Folgen Sie uns</text>
      <rect x="820" y="7710" width="36" height="36" rx="8" fill="${COLORS.brandDeep}" />
      <rect x="866" y="7710" width="36" height="36" rx="8" fill="${COLORS.brandDeep}" />
      <rect x="912" y="7710" width="36" height="36" rx="8" fill="${COLORS.brandDeep}" />

      <!-- bottom -->
      <rect x="80" y="7910" width="1040" height="1" fill="${COLORS.textMuted}" opacity="0.5" />
      <text x="80" y="7950" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="12" fill="${COLORS.greyMedium}">© 2026 Mustermann GmbH. Alle Rechte vorbehalten.</text>
    </g>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${COLORS.surface}" />
    ${chrome}
    ${header}
    ${hero}
    ${features}
    ${aboutUs}
    ${testimonials}
    ${statistics}
    ${pricing}
    ${cta}
    ${footer}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Google-Docs Dokument — 1100 x 6000 (tall, scrollable)
// ---------------------------------------------------------------------------

function buildGoogleDocsDocument(): string {
  const W = 1100;
  const H = 6000;

  // Paper centered with margins
  const paperX = 100;
  const paperW = W - 200;

  const sections: string[] = [];

  // Title block
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="180" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="18" fill="#5F6368">Persönliches Angebot · Vertraulich</text>
      <text x="${paperX + 40}" y="260" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="48" fill="#202124">Angebot für Mustermann GmbH</text>
      <text x="${paperX + 40}" y="320" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="22" fill="#5F6368">Vorbereitet für Max Mustermann · 20. Juni 2026</text>
      <rect x="${paperX + 40}" y="350" width="200" height="3" fill="#1A73E8" />
    </g>
  `);

  // Section: Zusammenfassung
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="500" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">Zusammenfassung</text>
      <text x="${paperX + 40}" y="560" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Sehr geehrter Herr Mustermann,</text>
      <text x="${paperX + 40}" y="600" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">vielen Dank für Ihr Interesse an unseren Industrie-Lösungen. Auf</text>
      <text x="${paperX + 40}" y="630" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">den folgenden Seiten finden Sie unser massgeschneidertes Angebot,</text>
      <text x="${paperX + 40}" y="660" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">abgestimmt auf die in unserem Vorgespräch besprochenen</text>
      <text x="${paperX + 40}" y="690" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Anforderungen Ihres Maschinenparks in München-Riem.</text>
    </g>
  `);

  // Section: Leistungsumfang
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="840" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">1. Leistungsumfang</text>

      <text x="${paperX + 40}" y="900" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">1.1 Wartung &amp; Inspektion</text>
      <text x="${paperX + 60}" y="940" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Vierteljährliche Sichtprüfung aller Anlagen</text>
      <text x="${paperX + 60}" y="970" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Schmierung und Verschleißteil-Tausch</text>
      <text x="${paperX + 60}" y="1000" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Schwingungsanalyse mit digitalem Protokoll</text>

      <text x="${paperX + 40}" y="1070" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">1.2 24/7-Notfall-Service</text>
      <text x="${paperX + 60}" y="1110" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Reaktionszeit ≤ 4 Stunden im DACH-Raum</text>
      <text x="${paperX + 60}" y="1140" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Direkter Draht zu Ihrem zugewiesenen Techniker</text>
      <text x="${paperX + 60}" y="1170" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Ersatzteile aus eigenem Zentrallager Stuttgart</text>

      <text x="${paperX + 40}" y="1240" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">1.3 Schulungspaket</text>
      <text x="${paperX + 60}" y="1280" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• 2 Schulungstage vor Ort jährlich</text>
      <text x="${paperX + 60}" y="1310" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Online-Zugriff auf unser Lernportal für 5 Mitarbeiter</text>
    </g>
  `);

  // Section: Kostenübersicht (Tabelle)
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="1480" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">2. Kostenübersicht</text>

      <!-- Table -->
      <rect x="${paperX + 40}" y="1520" width="${paperW - 80}" height="60" fill="#F1F3F4" />
      <text x="${paperX + 60}" y="1560" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="#3C4043">Position</text>
      <text x="${paperX + 500}" y="1560" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="#3C4043">Häufigkeit</text>
      <text x="${paperX + paperW - 240}" y="1560" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="18" fill="#3C4043" text-anchor="end">Preis (netto)</text>

      ${[
        ["Wartung & Inspektion", "4× pro Jahr", "4.200 €"],
        ["24/7-Notfall-Service", "Jahres-Flatrate", "8.400 €"],
        ["Schulungspaket", "Jährlich", "2.800 €"],
        ["Reisekosten Pauschale", "Inklusive", "0 €"],
      ].map(([pos, freq, price], i) => `
        <g>
          <rect x="${paperX + 40}" y="${1580 + i * 60}" width="${paperW - 80}" height="60" fill="${i % 2 === 1 ? "#F8F9FA" : "#FFFFFF"}" />
          <text x="${paperX + 60}" y="${1620 + i * 60}" font-family="${FONT_FAMILY}" font-weight="400" font-size="18" fill="#202124">${esc(pos)}</text>
          <text x="${paperX + 500}" y="${1620 + i * 60}" font-family="${FONT_FAMILY}" font-weight="400" font-size="18" fill="#3C4043">${esc(freq)}</text>
          <text x="${paperX + paperW - 240}" y="${1620 + i * 60}" font-family="${FONT_FAMILY}" font-weight="600" font-size="18" fill="#202124" text-anchor="end">${esc(price)}</text>
        </g>
      `).join("")}

      <!-- Total -->
      <rect x="${paperX + 40}" y="1840" width="${paperW - 80}" height="70" fill="#E8F0FE" />
      <text x="${paperX + 60}" y="1885" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="22" fill="#1967D2">Gesamtpreis pro Jahr (netto)</text>
      <text x="${paperX + paperW - 240}" y="1885" font-family="${FONT_FAMILY}" font-weight="700"
            font-size="22" fill="#1967D2" text-anchor="end">15.400 €</text>
    </g>
  `);

  // Section: Leistungsabgrenzung
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="2080" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">3. Leistungsabgrenzung</text>
      <text x="${paperX + 40}" y="2140" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Nicht im Festpreis enthalten sind:</text>
      <text x="${paperX + 60}" y="2185" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Schäden durch unsachgemäße Bedienung</text>
      <text x="${paperX + 60}" y="2215" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Anlagen ausserhalb der vereinbarten Liste (Annex A)</text>
      <text x="${paperX + 60}" y="2245" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="19" fill="#3C4043">• Umbau- und Erweiterungsarbeiten</text>
      <text x="${paperX + 40}" y="2310" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Diese Punkte rechnen wir nach Aufwand zum Stundensatz</text>
      <text x="${paperX + 40}" y="2340" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">von 95 € (netto) ab.</text>
    </g>
  `);

  // Section: Vertragsbedingungen
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="2520" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">4. Vertragsbedingungen</text>

      <text x="${paperX + 40}" y="2580" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">Laufzeit</text>
      <text x="${paperX + 40}" y="2620" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">12 Monate ab Vertragsbeginn, danach jährlich kündbar mit</text>
      <text x="${paperX + 40}" y="2650" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">3-monatiger Frist.</text>

      <text x="${paperX + 40}" y="2730" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">Zahlungsbedingungen</text>
      <text x="${paperX + 40}" y="2770" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Quartalsweise im Voraus, Zahlungsziel 14 Tage netto.</text>

      <text x="${paperX + 40}" y="2850" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="22" fill="#202124">SLA-Garantie</text>
      <text x="${paperX + 40}" y="2890" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Bei Überschreitung der 4-Stunden-Reaktionszeit erstatten wir</text>
      <text x="${paperX + 40}" y="2920" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">20 % der Monatspauschale.</text>
    </g>
  `);

  // Section: Unterschrift
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="3100" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">5. Annahme</text>
      <text x="${paperX + 40}" y="3160" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">Wir freuen uns über Ihr Vertrauen. Bitte gegenzeichnen und</text>
      <text x="${paperX + 40}" y="3190" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="20" fill="#3C4043">zurücksenden an angebot@mustermann-industrie.de.</text>

      <!-- Sign-off boxes -->
      <line x1="${paperX + 40}" y1="3360" x2="${paperX + 440}" y2="3360" stroke="#3C4043" stroke-width="1" />
      <text x="${paperX + 40}" y="3390" font-family="${FONT_FAMILY}" font-weight="500"
            font-size="16" fill="#5F6368">Max Mustermann, Geschäftsführung</text>

      <line x1="${paperX + 540}" y1="3360" x2="${paperX + 940}" y2="3360" stroke="#3C4043" stroke-width="1" />
      <text x="${paperX + 540}" y="3390" font-family="${FONT_FAMILY}" font-weight="500"
            font-size="16" fill="#5F6368">Datum</text>
    </g>
  `);

  // Section: Annex A — Anlagenliste
  sections.push(`
    <g>
      <text x="${paperX + 40}" y="3580" font-family="${FONT_FAMILY}" font-weight="600"
            font-size="28" fill="#202124">Annex A: Anlagenliste</text>
      <text x="${paperX + 40}" y="3630" font-family="${FONT_FAMILY}" font-weight="400"
            font-size="18" fill="#5F6368">Die folgenden 8 Anlagen sind im Vertragsumfang enthalten.</text>

      ${[
        ["Hydraulik-Pressen Typ HP-280", "Halle 1, Standort A-12 / A-14", "2 Stück"],
        ["CNC-Fräsen DMG MORI", "Halle 2, Standort B-3 / B-4", "2 Stück"],
        ["Schweißroboter KUKA KR-300", "Halle 2, Standort B-7", "1 Stück"],
        ["Lackieranlage Dürr EcoBell", "Halle 3, Standort C-1", "1 Stück"],
        ["Förderband-System Typ FB-12", "Übergreifend Halle 1-3", "1 Linie"],
        ["Lager-Stapler Linde H35", "Außenbereich", "1 Stück"],
      ].map(([name, loc, count], i) => `
        <g>
          <rect x="${paperX + 40}" y="${3680 + i * 110}" width="${paperW - 80}" height="100" rx="6" fill="${i % 2 === 1 ? "#F8F9FA" : "#FFFFFF"}" stroke="#DADCE0" stroke-width="1" />
          <text x="${paperX + 60}" y="${3720 + i * 110}" font-family="${FONT_FAMILY}" font-weight="600" font-size="20" fill="#202124">${esc(name)}</text>
          <text x="${paperX + 60}" y="${3750 + i * 110}" font-family="${FONT_FAMILY}" font-weight="400" font-size="16" fill="#5F6368">${esc(loc)}</text>
          <text x="${paperX + paperW - 100}" y="${3735 + i * 110}" font-family="${FONT_FAMILY}" font-weight="600" font-size="20" fill="#1967D2" text-anchor="end">${esc(count)}</text>
        </g>
      `).join("")}
    </g>
  `);

  // Footer
  sections.push(`
    <g>
      <line x1="${paperX + 40}" y1="${H - 240}" x2="${paperX + paperW - 40}" y2="${H - 240}" stroke="#DADCE0" stroke-width="1" />
      <text x="${paperX + 40}" y="${H - 200}" font-family="${FONT_FAMILY}" font-weight="600" font-size="16" fill="#202124">Mustermann Industrie GmbH</text>
      <text x="${paperX + 40}" y="${H - 175}" font-family="${FONT_FAMILY}" font-weight="400" font-size="14" fill="#5F6368">Industriestraße 42 · 85737 Ismaning · Deutschland</text>
      <text x="${paperX + 40}" y="${H - 150}" font-family="${FONT_FAMILY}" font-weight="400" font-size="14" fill="#5F6368">+49 89 / 123 456 78 · angebot@mustermann-industrie.de</text>
      <text x="${paperX + paperW - 40}" y="${H - 200}" text-anchor="end" font-family="${FONT_FAMILY}" font-weight="400" font-size="14" fill="#5F6368">Vertraulich · Nur für den Adressaten</text>
    </g>
  `);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#F8F9FA" />
    <!-- Paper -->
    <rect x="${paperX}" y="40" width="${paperW}" height="${H - 80}" fill="#FFFFFF" filter="url(#paperShadow)" />
    <defs>
      <filter id="paperShadow" x="-2%" y="-2%" width="104%" height="104%">
        <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.08" />
      </filter>
    </defs>
    ${sections.join("\n")}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface AssetSpec {
  name: string;
  width: number;
  height: number;
  build: () => string;
}

const ASSETS: AssetSpec[] = [
  { name: "website-screenshot.png", width: 1200, height: 8000, build: buildWebsiteScreenshot },
  { name: "slide-1.png", width: 1920, height: 1080, build: buildSlide1 },
  { name: "slide-2.png", width: 1920, height: 1080, build: buildSlide2 },
  { name: "slide-3.png", width: 1920, height: 1080, build: buildSlide3 },
  { name: "slide-4.png", width: 1920, height: 1080, build: buildSlide4 },
  { name: "slide-5.png", width: 1920, height: 1080, build: buildSlide5 },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), "public/demo-assets");
  await fs.mkdir(outDir, { recursive: true });

  for (const asset of ASSETS) {
    const svg = asset.build();
    const outPath = path.join(outDir, asset.name);
    await sharp(Buffer.from(svg), { density: 96 })
      .resize(asset.width, asset.height, { fit: "fill" })
      .png({ compressionLevel: 8 })
      .toFile(outPath);

    const stat = await fs.stat(outPath);
    console.log(
      `  ✓ ${asset.name.padEnd(28)} ${asset.width}×${asset.height}  ${formatBytes(stat.size)}`,
    );
  }

  console.log(`\nAll assets written to ${outDir}`);
}

main().catch((err) => {
  console.error("Failed to generate demo assets:", err);
  process.exit(1);
});
