/**
 * Pixel-perfect Google-Docs toolbar mock.
 *
 * Renders a self-contained HTML fragment + CSS that visually matches the
 * current docs.google.com chrome (as of 2026, Material-3-Look). Used by the
 * worker render pipeline so the modal preview, the per-lead video render and
 * the Bunny-hosted iframe variant all share an identical look — scroll
 * positions therefore map 1:1 between them.
 *
 * No React/JSX, no external font/icon requests. Icons are inline SVG strings.
 * Font family degrades gracefully to system-ui if Google Sans isn't on the
 * host (which is the common case — we never load a webfont).
 *
 * Three rows + ruler (fixed total height 160px = GDOCS_TOOLBAR_HEIGHT_PX):
 *   1. Title bar  (52px) — Docs logo, title + star/move/cloud inline,
 *                          history, comments, Meet, "Teilen"-Split-Pill,
 *                          "Upgraden"-Pill, avatar with colour ring.
 *   2. Menu bar   (30px) — Datei / Bearbeiten / … indented under the title.
 *   3. Format bar (40px + 8px margins) — rounded pill: "Menüs" search pill,
 *                          undo/redo/print/spell/paint, zoom, styles, font,
 *                          size widget, B/I/U, colors, link/comment/image,
 *                          alignment/lists/indent, "Bearbeiten" mode.
 *   4. Ruler      (30px) — tick marks, numbers, blue margin handles.
 *
 * The render pipeline reserves the stacked height via `padding-top: 160px`
 * on the body; `.gd-toolbar` pins itself to exactly 160px (overflow hidden)
 * so the worker's 1280×160 toolbar screenshot always crops cleanly.
 */

export interface ToolbarOptions {
  /** Visible doc title in the title bar. Default: "Unbenanntes Dokument". */
  docTitle?: string;
}

/* -------------------------------------------------------------------------- */
/* Inline SVG icon strings (24x24 viewBox unless noted, current-color stroke).  */
/* -------------------------------------------------------------------------- */

// Material-style icons traced from docs.google.com.
const ICON_STAR =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg>';
const ICON_FOLDER_MOVE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"/></svg>';
const ICON_CLOUD_CHECK =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.5-2A4 4 0 0 0 5 18z"/><polyline points="9 13 11 15 15 11"/></svg>';
const ICON_HISTORY =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3.5 3.5 3.5 8 8 8"/><polyline points="12 7.5 12 12 15.5 14"/></svg>';
const ICON_COMMENT =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/></svg>';
const ICON_VIDEO_CALL =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><polygon points="16 10 22 7 22 17 16 14"/></svg>';
const ICON_PERSON_ADD =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4"/><path d="M3.5 19.5c0-3.3 2.9-5.2 6.5-5.2s6.5 1.9 6.5 5.2"/><line x1="19" y1="8" x2="19" y2="13"/><line x1="16.5" y1="10.5" x2="21.5" y2="10.5"/></svg>';
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/></svg>';
const ICON_UNDO =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L3 9l6-5"/><path d="M3 9h11a7 7 0 0 1 7 7v2"/></svg>';
const ICON_REDO =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l6-5-6-5"/><path d="M21 9H10a7 7 0 0 0-7 7v2"/></svg>';
const ICON_PRINT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><rect x="6" y="14" width="12" height="7"/></svg>';
const ICON_SPELL =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19l4-12 4 12"/><path d="M5.5 15h5"/><polyline points="14 12 17 15 22 9"/></svg>';
const ICON_PAINT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h14v4H3z"/><path d="M5 7v4h12V7"/><path d="M11 11v4h3v5h-2v-5"/></svg>';
const ICON_CHEVRON_DOWN =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_CHEVRON_DOWN_SM =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_CHEVRON_UP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
const ICON_MINUS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_TEXT_COLOR =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L11 6h2l5 12"/><path d="M8 14h8"/><rect x="5" y="20" width="14" height="2.5" fill="#EA4335" stroke="none" rx="1"/></svg>';
const ICON_HIGHLIGHT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-3 5h4l1.5-2.5"/><path d="M16 3l5 5-9 9-5 1 1-5z"/><rect x="5" y="20" width="14" height="2.5" fill="#FFEB3B" stroke="none" rx="1"/></svg>';
const ICON_LINK =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>';
const ICON_IMAGE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 17l-6-6-9 9"/></svg>';
const ICON_ADD_COMMENT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/></svg>';
const ICON_CHECKLIST =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 5 9 9 5"/><line x1="12" y1="7" x2="21" y2="7"/><polyline points="3 16 5 18 9 14"/><line x1="12" y1="17" x2="21" y2="17"/></svg>';
const ICON_ALIGN_LEFT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="11" x2="14" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="14" y2="21"/></svg>';
const ICON_LINE_SPACING =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><polyline points="6 4 4 6 6 8"/><polyline points="6 20 4 18 6 16"/><line x1="4" y1="6" x2="4" y2="18"/></svg>';
const ICON_LIST_BULLET =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="13" r="1.2" fill="currentColor"/><circle cx="5" cy="19" r="1.2" fill="currentColor"/><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="13" x2="20" y2="13"/><line x1="9" y1="19" x2="20" y2="19"/></svg>';
const ICON_LIST_NUMBER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><text x="2" y="9" font-size="6" font-family="Arial" fill="currentColor" stroke="none">1.</text><text x="2" y="15" font-size="6" font-family="Arial" fill="currentColor" stroke="none">2.</text><text x="2" y="21" font-size="6" font-family="Arial" fill="currentColor" stroke="none">3.</text><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="13" x2="20" y2="13"/><line x1="9" y1="19" x2="20" y2="19"/></svg>';
const ICON_INDENT_DEC =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="11" x2="20" y2="11"/><line x1="10" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="20" y2="21"/><polyline points="7 9 4 12 7 15"/></svg>';
const ICON_INDENT_INC =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="11" x2="20" y2="11"/><line x1="10" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="20" y2="21"/><polyline points="4 9 7 12 4 15"/></svg>';
const ICON_REMOVE_FORMAT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h12"/><path d="M9 7l-3 14"/><path d="M11 7l-1 5"/><line x1="14" y1="14" x2="22" y2="22"/><line x1="22" y1="14" x2="14" y2="22"/></svg>';
const ICON_EDIT_MODE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-10 10H4v-6z"/></svg>';

/**
 * Logo mark for the Docs icon — small rounded blue tile with a stylised
 * white "D". Inline SVG so it survives offline embedding.
 */
// Offizielles Google-Docs Logo (vereinfacht aus der Sketch-Vorlage von
// commons.wikimedia.org/wiki/File:Google_Docs_logo_(2014-2020).svg).
// Original-viewBox 47x65, alle Sub-Pfade auf einen einzigen clipPath
// reduziert. Farben + Geometrie exakt wie im Original.
const DOCS_LOGO = `
<svg viewBox="0 0 47 65" width="26" height="36" aria-hidden="true">
  <defs>
    <linearGradient id="gdocs-fold-grad" x1="50%" y1="8.6%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#1A237E" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#1A237E" stop-opacity="0.02"/>
    </linearGradient>
    <clipPath id="gdocs-clip">
      <path d="M29.375,0 L4.40625,0 C1.9828125,0 0,1.9943 0,4.4318 L0,60.5682 C0,63.0057 1.9828125,65 4.40625,65 L42.59375,65 C45.0171875,65 47,63.0057 47,60.5682 L47,17.7273 L29.375,0 Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#gdocs-clip)">
    <rect width="47" height="65" fill="#4285F4"/>
    <polygon points="30.66 16.43 47 32.86 47 17.73" fill="url(#gdocs-fold-grad)"/>
    <path d="M29.375,0 L29.375,13.295 C29.375,15.744 31.347,17.727 33.781,17.727 L47,17.727 L29.375,0 Z" fill="#A1C2FA"/>
    <rect x="11.75" y="32.5" width="23.5" height="2.955" fill="#F1F1F1"/>
    <rect x="11.75" y="38.41" width="23.5" height="2.955" fill="#F1F1F1"/>
    <rect x="11.75" y="44.32" width="23.5" height="2.955" fill="#F1F1F1"/>
    <rect x="11.75" y="50.23" width="17.625" height="2.955" fill="#F1F1F1"/>
  </g>
</svg>`;

/* -------------------------------------------------------------------------- */
/* HTML builders                                                              */
/* -------------------------------------------------------------------------- */

function iconBtn(svg: string, label: string, extraCls = ""): string {
  // `aria-label` doubles as a hover tooltip in our minimal CSS (title attr).
  return `<button type="button" class="gd-icon-btn ${extraCls}" title="${escapeAttr(label)}">${svg}</button>`;
}

/** Icon-Button mit kleinem Dropdown-Chevron rechts (Ausrichtung, Listen …). */
function iconDropBtn(svg: string, label: string): string {
  return `<button type="button" class="gd-icon-btn gd-icon-drop" title="${escapeAttr(label)}">${svg}${ICON_CHEVRON_DOWN_SM}</button>`;
}

function divider(): string {
  return '<span class="gd-vdivider" aria-hidden="true"></span>';
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Returns the toolbar HTML fragment. The fragment is wrapped in a single
 * `<div class="gd-toolbar">…</div>` root so the caller can drop it directly
 * into the `<body>` before the doc stack.
 */
export function getGDocsToolbarHtml(opts?: ToolbarOptions): string {
  const title = escapeHtml(opts?.docTitle ?? "Unbenanntes Dokument");

  // Row 1: title bar — Titel + Doc-Icons inline, rechts App-Icons + Pills.
  const row1 = `
    <div class="gd-row gd-row-title">
      <div class="gd-logo">${DOCS_LOGO}</div>
      <div class="gd-title">${title}</div>
      <div class="gd-title-icons">
        ${iconBtn(ICON_STAR, "Markieren", "gd-title-icon")}
        ${iconBtn(ICON_FOLDER_MOVE, "Verschieben", "gd-title-icon")}
        ${iconBtn(ICON_CLOUD_CHECK, "In Drive gespeichert", "gd-title-icon")}
      </div>
      <div class="gd-spacer"></div>
      <div class="gd-header-icons">
        ${iconBtn(ICON_HISTORY, "Versionsverlauf", "gd-header-icon")}
        ${iconBtn(ICON_COMMENT, "Kommentarverlauf öffnen", "gd-header-icon")}
        <button type="button" class="gd-icon-btn gd-header-icon gd-icon-drop" title="An einem Anruf teilnehmen">${ICON_VIDEO_CALL}${ICON_CHEVRON_DOWN_SM}</button>
      </div>
      <span class="gd-share-split">
        <button type="button" class="gd-share-main" title="Freigeben">
          ${ICON_PERSON_ADD}<span>Teilen</span>
        </button>
        <button type="button" class="gd-share-arrow" title="Freigabeoptionen">${ICON_CHEVRON_DOWN_SM}</button>
      </span>
      <button type="button" class="gd-upgrade-pill" title="Upgraden">Upgraden</button>
      <span class="gd-avatar-ring" aria-hidden="true"><span class="gd-avatar">D</span></span>
    </div>`;

  // Row 2: menu bar — eingerückt, damit sie wie im Original unter dem
  // Titel (rechts vom Logo) sitzt.
  const menuItems = [
    "Datei",
    "Bearbeiten",
    "Ansicht",
    "Einfügen",
    "Format",
    "Tools",
    "Erweiterungen",
    "Hilfe",
  ];
  const row2 = `
    <div class="gd-row gd-row-menu">
      ${menuItems
        .map((label) => `<span class="gd-menu">${escapeHtml(label)}</span>`)
        .join("")}
    </div>`;

  // Row 3: format toolbar (abgerundete Material-3-Pille).
  const row3 = `
    <div class="gd-row gd-row-format">
      <button type="button" class="gd-menus-pill" title="Menüs durchsuchen">
        ${ICON_SEARCH}<span>Menüs</span>
      </button>
      ${iconBtn(ICON_UNDO, "Rückgängig")}
      ${iconBtn(ICON_REDO, "Wiederherstellen")}
      ${iconBtn(ICON_PRINT, "Drucken")}
      ${iconBtn(ICON_SPELL, "Rechtschreibprüfung")}
      ${iconBtn(ICON_PAINT, "Formatierung übertragen")}
      <button type="button" class="gd-dropdown" title="Zoom">
        <span>100%</span>${ICON_CHEVRON_DOWN}
      </button>
      ${divider()}
      <button type="button" class="gd-dropdown gd-dropdown-wide" title="Stile">
        <span>Normaler Text</span>${ICON_CHEVRON_DOWN}
      </button>
      ${divider()}
      <button type="button" class="gd-dropdown gd-dropdown-font" title="Schriftart">
        <span>Arial</span>${ICON_CHEVRON_DOWN}
      </button>
      ${divider()}
      <div class="gd-size-widget" title="Schriftgröße">
        <button type="button" class="gd-icon-btn gd-size-btn">${ICON_MINUS}</button>
        <span class="gd-size-value">11</span>
        <button type="button" class="gd-icon-btn gd-size-btn">${ICON_PLUS}</button>
      </div>
      ${divider()}
      <button type="button" class="gd-icon-btn gd-format-letter" title="Fett"><b>B</b></button>
      <button type="button" class="gd-icon-btn gd-format-letter" title="Kursiv"><i>I</i></button>
      <button type="button" class="gd-icon-btn gd-format-letter" title="Unterstrichen"><u>U</u></button>
      ${iconBtn(ICON_TEXT_COLOR, "Textfarbe")}
      ${iconBtn(ICON_HIGHLIGHT, "Markierungsfarbe")}
      ${divider()}
      ${iconBtn(ICON_LINK, "Link einfügen")}
      ${iconBtn(ICON_ADD_COMMENT, "Kommentar hinzufügen")}
      ${iconBtn(ICON_IMAGE, "Bild einfügen")}
      ${divider()}
      ${iconDropBtn(ICON_ALIGN_LEFT, "Ausrichten")}
      ${iconDropBtn(ICON_LINE_SPACING, "Zeilen- und Absatzabstand")}
      ${iconDropBtn(ICON_CHECKLIST, "Checkliste")}
      ${iconDropBtn(ICON_LIST_BULLET, "Aufzählung")}
      ${iconDropBtn(ICON_LIST_NUMBER, "Nummerierte Liste")}
      ${iconBtn(ICON_INDENT_DEC, "Einzug verringern")}
      ${iconBtn(ICON_INDENT_INC, "Einzug erhöhen")}
      ${iconBtn(ICON_REMOVE_FORMAT, "Formatierung entfernen")}
      <div class="gd-spacer"></div>
      <button type="button" class="gd-edit-mode" title="Bearbeitungsmodus">
        ${ICON_EDIT_MODE}<span>Bearbeiten</span>${ICON_CHEVRON_DOWN_SM}
      </button>
      ${divider()}
      ${iconBtn(ICON_CHEVRON_UP, "Menüs ausblenden")}
    </div>`;

  // Ruler: cm-Skala mit Major-Ticks je 1 cm (Minor je 0,25 cm), zentriert
  // über dem 850px-Stack (aktive Fläche ≈ 700px ≈ 18 cm). Blaue
  // Einzugs-Marker an beiden Rändern wie im Original.
  const tickCount = 72; // 18 cm * 4 minor ticks
  const ticks: string[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const major = i % 4 === 0;
    const num = i / 4;
    ticks.push(
      `<span class="gd-ruler-tick${major ? " gd-ruler-tick-major" : ""}">${
        major && num > 0 && num < 18 ? `<span class="gd-ruler-num">${num}</span>` : ""
      }</span>`,
    );
  }
  const ruler = `
    <div class="gd-row gd-row-ruler">
      <div class="gd-ruler">
        <span class="gd-ruler-margin gd-ruler-margin-left" aria-hidden="true"></span>
        <div class="gd-ruler-ticks">${ticks.join("")}</div>
        <span class="gd-ruler-margin gd-ruler-margin-right" aria-hidden="true"></span>
      </div>
    </div>`;

  return `<div class="gd-toolbar" role="region" aria-label="Google Docs Toolbar">
    ${row1}
    ${row2}
    ${row3}
    ${ruler}
  </div>`;
}

/**
 * Returns the toolbar CSS, scoped to `.gd-toolbar` selectors. Inline the
 * return value into a `<style>` block in the host HTML.
 */
export function getGDocsToolbarCss(): string {
  return `
    :root {
      --gd-bg: #F1F3F4;
      --gd-white: #FFFFFF;
      --gd-text: #1F1F1F;
      --gd-text-secondary: #5F6368;
      --gd-text-tertiary: #444746;
      --gd-blue: #1A73E8;
      --gd-blue-hover: #1765CC;
      --gd-divider: #E0E0E0;
      --gd-hover: #F1F3F4;
      --gd-pill: #EDF2FA;
      --gd-share-bg: #C2E7FF;
      --gd-share-text: #001D35;
      --gd-upgrade-bg: #D3E3FD;
      --gd-upgrade-text: #0B57D0;
      --gd-page-shadow: 0 1px 3px rgba(60,64,67,0.15), 0 1px 2px rgba(60,64,67,0.10);
      --gd-toolbar-h: 160px;
      --gd-font: 'Google Sans', 'Google Sans Text', 'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .gd-toolbar {
      position: fixed;
      top: 0; left: 0; right: 0;
      box-sizing: border-box;
      height: var(--gd-toolbar-h);
      overflow: hidden;
      background: var(--gd-white);
      border-bottom: 1px solid var(--gd-divider);
      z-index: 10;
      font-family: var(--gd-font);
      color: var(--gd-text);
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    .gd-toolbar * { box-sizing: border-box; }

    .gd-row {
      display: flex;
      align-items: center;
      width: 100%;
    }
    .gd-spacer { flex: 1 1 auto; }

    /* Row 1: title bar (52px) */
    .gd-row-title {
      height: 52px;
      padding: 0 16px;
      gap: 4px;
    }
    .gd-logo { display: flex; align-items: center; margin-right: 10px; flex: 0 0 auto; }
    .gd-logo svg { display: block; }
    .gd-title {
      font-size: 18px;
      font-weight: 400;
      color: var(--gd-text);
      line-height: 24px;
      padding: 1px 4px;
      border-radius: 4px;
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0;
      /* Titel sitzt im Original leicht oberhalb der Mitte (Menü darunter). */
      align-self: flex-start;
      margin-top: 6px;
    }
    .gd-title-icons {
      display: flex;
      align-items: center;
      gap: 0;
      color: var(--gd-text-secondary);
      align-self: flex-start;
      margin-top: 8px;
    }
    .gd-title-icon { width: 26px; height: 26px; flex: 0 0 26px; }
    .gd-title-icon svg { width: 16px; height: 16px; }

    .gd-header-icons {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--gd-text-tertiary);
      margin-right: 10px;
    }
    .gd-header-icon { width: 36px; height: 36px; flex: 0 0 auto; border-radius: 50%; }
    .gd-header-icon.gd-icon-drop { width: auto; padding: 0 6px; border-radius: 18px; }

    .gd-share-split {
      display: inline-flex;
      align-items: stretch;
      height: 38px;
      border-radius: 19px;
      overflow: hidden;
      background: var(--gd-share-bg);
      margin-left: 2px;
      box-shadow: none;
    }
    .gd-share-main {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: transparent;
      color: var(--gd-share-text);
      border: none;
      padding: 0 12px 0 16px;
      font: 500 14px/1 var(--gd-font);
      cursor: pointer;
    }
    .gd-share-main:hover { background: rgba(0,29,53,0.06); }
    .gd-share-arrow {
      display: inline-flex;
      align-items: center;
      background: transparent;
      color: var(--gd-share-text);
      border: none;
      border-left: 1px solid rgba(0,29,53,0.18);
      padding: 0 10px;
      cursor: pointer;
    }
    .gd-share-arrow:hover { background: rgba(0,29,53,0.06); }

    .gd-upgrade-pill {
      display: inline-flex;
      align-items: center;
      height: 38px;
      border-radius: 19px;
      background: var(--gd-upgrade-bg);
      color: var(--gd-upgrade-text);
      border: none;
      padding: 0 18px;
      font: 500 14px/1 var(--gd-font);
      cursor: pointer;
      margin-left: 10px;
    }
    .gd-upgrade-pill:hover { background: #C6DAFC; }

    .gd-avatar-ring {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px; height: 38px;
      border-radius: 50%;
      margin-left: 10px;
      background: conic-gradient(#4285F4, #EA4335, #FBBC04, #34A853, #4285F4);
      padding: 2px;
    }
    .gd-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%; height: 100%;
      border-radius: 50%;
      background: #7B1FA2;
      border: 2px solid var(--gd-white);
      color: var(--gd-white);
      font-size: 14px;
      font-weight: 500;
    }

    /* Row 2: menu bar (30px) — beginnt unter dem Titel, rechts vom Logo. */
    .gd-row-menu {
      height: 30px;
      padding: 0 16px 0 50px;
      gap: 0;
      color: var(--gd-text);
      font-size: 14px;
      margin-top: -8px;
    }
    .gd-menu {
      padding: 3px 8px;
      border-radius: 8px;
      cursor: default;
      line-height: 18px;
    }
    .gd-menu:hover { background: var(--gd-hover); }

    /* Row 3: format toolbar (40px Pille + 4px Rand oben/unten) */
    .gd-row-format {
      height: 40px;
      padding: 0 8px;
      gap: 1px;
      background: var(--gd-pill);
      border-radius: 9999px;
      margin: 4px 16px;
      width: auto;
      align-self: stretch;
    }

    .gd-menus-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      border-radius: 9999px;
      background: var(--gd-white);
      border: none;
      color: var(--gd-text);
      font: 400 13px/1 var(--gd-font);
      padding: 0 10px 0 8px;
      margin-right: 2px;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(60,64,67,0.12);
      white-space: nowrap;
    }
    .gd-menus-pill svg { color: var(--gd-text-secondary); }

    .gd-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--gd-text-tertiary);
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
      flex: 0 0 26px;
    }
    .gd-icon-btn:hover { background: rgba(60,64,67,0.08); color: var(--gd-text); }
    .gd-icon-btn svg { display: block; }
    .gd-icon-drop {
      width: auto;
      flex: 0 0 auto;
      padding: 0 3px 0 4px;
      gap: 1px;
    }
    .gd-icon-drop svg:last-child { color: var(--gd-text-secondary); }

    .gd-format-letter {
      font-family: var(--gd-font);
      font-size: 14px;
      color: var(--gd-text-tertiary);
      letter-spacing: 0;
    }
    .gd-format-letter b, .gd-format-letter i, .gd-format-letter u {
      font-style: normal; font-weight: 600;
    }
    .gd-format-letter i { font-style: italic; font-weight: 500; }
    .gd-format-letter u { text-decoration: underline; font-weight: 500; }

    .gd-vdivider {
      width: 1px;
      height: 20px;
      background: #C4C7C5;
      margin: 0 3px;
      flex: 0 0 1px;
    }

    .gd-dropdown {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      border: none;
      border-radius: 4px;
      padding: 0 6px;
      height: 28px;
      color: var(--gd-text);
      font: 13px/1 var(--gd-font);
      cursor: pointer;
      white-space: nowrap;
    }
    .gd-dropdown:hover { background: rgba(60,64,67,0.08); }
    .gd-dropdown svg { color: var(--gd-text-tertiary); }
    .gd-dropdown-wide { min-width: 104px; justify-content: space-between; }
    .gd-dropdown-font { min-width: 74px; justify-content: space-between; }

    .gd-size-widget {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 2px;
      border-radius: 4px;
    }
    .gd-size-btn { width: 22px; height: 22px; flex: 0 0 22px; }
    .gd-size-value {
      display: inline-block;
      width: 30px;
      text-align: center;
      font-size: 13px;
      color: var(--gd-text);
      border: 1px solid var(--gd-text-tertiary);
      border-radius: 4px;
      background: transparent;
      padding: 3px 0;
      line-height: 1;
    }

    .gd-edit-mode {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      color: var(--gd-text-tertiary);
      border: none;
      border-radius: 4px;
      height: 28px;
      padding: 0 8px;
      font: 500 13px/1 var(--gd-font);
      cursor: pointer;
    }
    .gd-edit-mode:hover { background: rgba(60,64,67,0.08); }
    .gd-edit-mode svg:last-child { color: var(--gd-text-secondary); }

    /* Row 4: ruler (30px) */
    .gd-row-ruler {
      height: 30px;
      background: var(--gd-white);
      padding: 0;
      justify-content: center;
    }
    .gd-ruler {
      position: relative;
      width: 850px;
      max-width: 100%;
      height: 100%;
      display: flex;
      align-items: stretch;
    }
    .gd-ruler-margin {
      width: 75px;
      position: relative;
    }
    /* Blaue Einzugs-Marker (▼) wie im Original. */
    .gd-ruler-margin::after {
      content: "";
      position: absolute;
      bottom: 4px;
      width: 10px;
      height: 8px;
      background: #4285F4;
      clip-path: polygon(50% 100%, 100% 0, 0 0);
    }
    .gd-ruler-margin-left::after { right: -5px; }
    /* Erstzeilen-Einzug: kleiner blauer Balken über dem linken Marker. */
    .gd-ruler-margin-left::before {
      content: "";
      position: absolute;
      bottom: 13px;
      right: -5px;
      width: 10px;
      height: 3px;
      background: #4285F4;
    }
    .gd-ruler-margin-right::after { left: -5px; }
    .gd-ruler-ticks {
      flex: 1;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding: 0 4px 4px;
      position: relative;
    }
    .gd-ruler-tick {
      display: inline-block;
      width: 1px;
      height: 4px;
      background: #BDC1C6;
      position: relative;
    }
    .gd-ruler-tick-major { height: 7px; background: #80868B; }
    .gd-ruler-num {
      position: absolute;
      top: -13px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      color: var(--gd-text-secondary);
      font-family: var(--gd-font);
    }
  `;
}
