/**
 * Pixel-perfect Google-Docs toolbar mock.
 *
 * Renders a self-contained HTML fragment + CSS that visually matches the
 * current docs.google.com chrome (as of 2026). Used by the worker render
 * pipeline so the modal preview, the per-lead video render and the
 * Bunny-hosted iframe variant all share an identical look — scroll positions
 * therefore map 1:1 between them.
 *
 * No React/JSX, no external font/icon requests. Icons are inline SVG strings.
 * Font family degrades gracefully to system-ui if Google Sans isn't on the
 * host (which is the common case — we never load a webfont).
 *
 * Three rows + ruler:
 *   1. Title bar  (44px) — Docs icon, title, star, move, "in Drive saved",
 *                          last-edit link, comments, video call, "Freigeben"
 *                          pill, avatar.
 *   2. Menu bar   (32px) — Datei / Bearbeiten / Ansicht / Einfügen / Format
 *                          / Tools / Erweiterungen / Hilfe.
 *   3. Format bar (40px) — Undo/Redo/Print/Spell/Paint, zoom dropdown,
 *                          style dropdown, font dropdown, size widget, B/I/U/S,
 *                          colors, link/image/comment/checklist, alignment,
 *                          line spacing, lists, indent, edit-mode toggle.
 *   4. Ruler      (~24px) — horizontal ruler with tick marks + margin handles.
 *
 * Total stacked height ~ 160px. The render pipeline reserves this via
 * `padding-top: 160px` on the body.
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
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.5-2A4 4 0 0 0 5 18z"/><polyline points="9 13 11 15 15 11"/></svg>';
const ICON_COMMENT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/></svg>';
const ICON_VIDEO_CALL =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><polygon points="16 10 22 7 22 17 16 14"/></svg>';
const ICON_KEY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="3.5"/><path d="M11 12l9-9 2 2-2 2 2 2-2 2-2-2"/></svg>';
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
const ICON_MINUS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_TEXT_COLOR =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L11 6h2l5 12"/><path d="M8 14h8"/><rect x="5" y="20" width="14" height="2" fill="#EA4335" stroke="none"/></svg>';
const ICON_HIGHLIGHT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-3 5h4l1.5-2.5"/><path d="M16 3l5 5-9 9-5 1 1-5z"/><rect x="5" y="20" width="14" height="2" fill="#FFEB3B" stroke="none"/></svg>';
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
const ICON_ALIGN_CENTER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="11" x2="17" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="7" y1="21" x2="17" y2="21"/></svg>';
const ICON_ALIGN_RIGHT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="10" y1="21" x2="20" y2="21"/></svg>';
const ICON_ALIGN_JUSTIFY =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="20" y2="21"/></svg>';
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
const ICON_SHOW_MENUS =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

/**
 * Logo mark for the Docs icon — small rounded blue tile with a stylised
 * white "D". Inline SVG so it survives offline embedding.
 */
// Offizielles Google-Docs Logo (vereinfacht aus der Sketch-Vorlage von
// commons.wikimedia.org/wiki/File:Google_Docs_logo_(2014-2020).svg).
// Original-viewBox 47x65, alle Sub-Pfade auf einen einzigen clipPath
// reduziert. Farben + Geometrie exakt wie im Original.
const DOCS_LOGO = `
<svg viewBox="0 0 47 65" width="24" height="33" aria-hidden="true">
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

  // Row 1: title bar.
  const row1 = `
    <div class="gd-row gd-row-title">
      <div class="gd-logo">${DOCS_LOGO}</div>
      <div class="gd-title-block">
        <div class="gd-title">${title}</div>
        <div class="gd-title-icons">
          ${iconBtn(ICON_STAR, "Markieren")}
          ${iconBtn(ICON_FOLDER_MOVE, "Verschieben")}
          <span class="gd-cloud">${ICON_CLOUD_CHECK}<span class="gd-cloud-label">In Drive gespeichert</span></span>
        </div>
      </div>
      <div class="gd-spacer"></div>
      <button type="button" class="gd-share-pill" title="Freigeben">
        <span class="gd-share-key">${ICON_KEY}</span>
        <span class="gd-share-label">Freigeben</span>
      </button>
      <span class="gd-avatar" aria-hidden="true">N</span>
    </div>`;

  // Row 2: menu bar.
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

  // Row 3: format toolbar.
  const row3 = `
    <div class="gd-row gd-row-format">
      ${iconBtn(ICON_UNDO, "Rückgängig")}
      ${iconBtn(ICON_REDO, "Wiederherstellen")}
      ${iconBtn(ICON_PRINT, "Drucken")}
      ${iconBtn(ICON_SPELL, "Rechtschreibung prüfen")}
      ${iconBtn(ICON_PAINT, "Formatierung übertragen")}
      ${divider()}
      <button type="button" class="gd-dropdown" title="Zoom">
        <span>100%</span>${ICON_CHEVRON_DOWN}
      </button>
      ${divider()}
      <button type="button" class="gd-dropdown gd-dropdown-wide" title="Stile">
        <span>Standardtext</span>${ICON_CHEVRON_DOWN}
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
      <button type="button" class="gd-icon-btn gd-format-letter" title="Durchgestrichen"><s>S</s></button>
      ${iconBtn(ICON_TEXT_COLOR, "Textfarbe")}
      ${iconBtn(ICON_HIGHLIGHT, "Markierungsfarbe")}
      ${divider()}
      ${iconBtn(ICON_LINK, "Link einfügen")}
      ${iconBtn(ICON_IMAGE, "Bild einfügen")}
      ${iconBtn(ICON_CHECKLIST, "Checkliste")}
      ${divider()}
      ${iconBtn(ICON_ALIGN_LEFT, "Linksbündig")}
      ${iconBtn(ICON_ALIGN_CENTER, "Zentriert")}
      ${iconBtn(ICON_ALIGN_RIGHT, "Rechtsbündig")}
      ${iconBtn(ICON_LINE_SPACING, "Zeilenabstand")}
      ${iconBtn(ICON_LIST_BULLET, "Aufzählung")}
      ${iconBtn(ICON_LIST_NUMBER, "Nummerierte Liste")}
      ${iconBtn(ICON_INDENT_DEC, "Einzug verringern")}
      ${iconBtn(ICON_INDENT_INC, "Einzug erhöhen")}
      <div class="gd-spacer"></div>
      <button type="button" class="gd-edit-mode" title="Bearbeitungsmodus">
        ${ICON_EDIT_MODE}<span>Editieren</span>
      </button>
    </div>`;

  // Ruler: 17 cm-style ticks evenly distributed; major ticks every 1cm,
  // minor ticks every .25cm. We render a synthetic 700px-wide ruler centred
  // over the doc stack (max-width 850 - 2*75 margins ≈ 700). Two triangular
  // margin handles bracket the active area.
  const tickCount = 64; // 16 cm * 4 minor ticks
  const ticks: string[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const major = i % 4 === 0;
    const num = i / 4;
    ticks.push(
      `<span class="gd-ruler-tick${major ? " gd-ruler-tick-major" : ""}">${
        major && num > 0 && num <= 16 ? `<span class="gd-ruler-num">${num}</span>` : ""
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
      --gd-text: #202124;
      --gd-text-secondary: #5F6368;
      --gd-text-tertiary: #444746;
      --gd-blue: #1A73E8;
      --gd-blue-hover: #1765CC;
      --gd-divider: #E0E0E0;
      --gd-hover: #F1F3F4;
      --gd-page-shadow: 0 1px 3px rgba(60,64,67,0.15), 0 1px 2px rgba(60,64,67,0.10);
      --gd-toolbar-h: 160px;
      --gd-font: 'Google Sans', 'Google Sans Text', 'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .gd-toolbar {
      position: fixed;
      top: 0; left: 0; right: 0;
      background: var(--gd-white);
      border-bottom: 1px solid var(--gd-divider);
      z-index: 10;
      font-family: var(--gd-font);
      color: var(--gd-text);
      user-select: none;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 1px 0 rgba(60,64,67,0.05);
    }
    .gd-toolbar * { box-sizing: border-box; }

    .gd-row {
      display: flex;
      align-items: center;
      width: 100%;
    }
    .gd-spacer { flex: 1 1 auto; }

    /* Row 1: title bar (44px) */
    .gd-row-title {
      height: 44px;
      padding: 0 14px 0 14px;
      gap: 4px;
    }
    .gd-logo { display: flex; align-items: center; margin-right: 6px; }
    .gd-logo svg { display: block; }
    .gd-title-block {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      flex: 0 1 auto;
    }
    .gd-title {
      font-size: 18px;
      font-weight: 400;
      color: var(--gd-text);
      line-height: 22px;
      padding: 2px 6px;
      border-radius: 4px;
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0;
    }
    .gd-title-icons {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 4px;
      color: var(--gd-text-secondary);
    }
    .gd-cloud {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--gd-text-secondary);
      padding: 0 8px;
      white-space: nowrap;
    }
    .gd-cloud-label { white-space: nowrap; }

    .gd-last-edit {
      font-size: 12px;
      color: var(--gd-text-secondary);
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .gd-last-edit:hover { background: var(--gd-hover); color: var(--gd-text); }

    .gd-with-badge { position: relative; }

    .gd-share-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--gd-blue);
      color: var(--gd-white);
      border: none;
      border-radius: 22px;
      height: 36px;
      padding: 0 18px 0 14px;
      font: 500 14px/1 var(--gd-font);
      cursor: pointer;
      margin-left: 4px;
      box-shadow: 0 1px 2px rgba(60,64,67,0.15);
    }
    .gd-share-pill:hover { background: var(--gd-blue-hover); }
    .gd-share-key svg { display: block; }
    .gd-share-label { letter-spacing: 0.2px; }

    .gd-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg,#FBBC04 0%,#EA4335 100%);
      color: var(--gd-white);
      font-size: 14px;
      font-weight: 500;
      margin-left: 6px;
    }

    /* Row 2: menu bar (32px) */
    .gd-row-menu {
      height: 32px;
      padding: 0 14px;
      gap: 2px;
      color: var(--gd-text-tertiary);
      font-size: 13px;
    }
    .gd-menu {
      padding: 4px 8px;
      border-radius: 4px;
      cursor: default;
      line-height: 16px;
    }
    .gd-menu:hover { background: var(--gd-hover); color: var(--gd-text); }

    /* Row 3: format toolbar (40px) */
    .gd-row-format {
      height: 40px;
      padding: 0 8px;
      gap: 2px;
      background: var(--gd-bg);
      border-top: 1px solid var(--gd-divider);
      border-bottom: 1px solid var(--gd-divider);
      border-radius: 24px;
      margin: 0 14px 4px;
      width: auto;
      align-self: stretch;
    }
    .gd-row-format { margin-top: 4px; height: 40px; }

    .gd-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--gd-text-tertiary);
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
      flex: 0 0 28px;
    }
    .gd-icon-btn:hover { background: rgba(60,64,67,0.08); color: var(--gd-text); }
    .gd-icon-btn svg { display: block; }

    .gd-format-letter {
      font-family: var(--gd-font);
      font-size: 14px;
      color: var(--gd-text-tertiary);
      letter-spacing: 0;
    }
    .gd-format-letter b, .gd-format-letter i, .gd-format-letter u, .gd-format-letter s {
      font-style: normal; font-weight: 600;
    }
    .gd-format-letter i { font-style: italic; font-weight: 500; }
    .gd-format-letter u { text-decoration: underline; font-weight: 500; }
    .gd-format-letter s { text-decoration: line-through; font-weight: 500; }

    .gd-vdivider {
      width: 1px;
      height: 20px;
      background: var(--gd-divider);
      margin: 0 4px;
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
    .gd-dropdown-wide { min-width: 110px; justify-content: space-between; }
    .gd-dropdown-font { min-width: 90px; justify-content: space-between; }

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
      width: 28px;
      text-align: center;
      font-size: 13px;
      color: var(--gd-text);
      border: 1px solid var(--gd-divider);
      border-radius: 2px;
      background: var(--gd-white);
      padding: 2px 0;
      line-height: 1;
    }

    .gd-edit-mode {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(26,115,232,0.10);
      color: var(--gd-blue);
      border: none;
      border-radius: 18px;
      height: 28px;
      padding: 0 12px;
      font: 500 13px/1 var(--gd-font);
      cursor: pointer;
      margin-right: 4px;
    }
    .gd-edit-mode:hover { background: rgba(26,115,232,0.16); }
    .gd-edit-mode svg { color: var(--gd-blue); }

    /* Row 4: ruler */
    .gd-row-ruler {
      height: 24px;
      background: var(--gd-white);
      border-top: 1px solid var(--gd-divider);
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
      background: #D2E3FC;
      opacity: 0.55;
      position: relative;
    }
    .gd-ruler-margin::after {
      content: "";
      position: absolute;
      bottom: 0;
      width: 10px;
      height: 10px;
      background: var(--gd-text-secondary);
      clip-path: polygon(50% 0, 100% 100%, 0 100%);
      opacity: 0.6;
    }
    .gd-ruler-margin-left::after { right: -5px; }
    .gd-ruler-margin-right::after { left: -5px; }
    .gd-ruler-ticks {
      flex: 1;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding: 0 4px;
      position: relative;
    }
    .gd-ruler-tick {
      display: inline-block;
      width: 1px;
      height: 4px;
      background: #BDC1C6;
      position: relative;
    }
    .gd-ruler-tick-major { height: 8px; background: #80868B; }
    .gd-ruler-num {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 9px;
      color: var(--gd-text-secondary);
      font-family: var(--gd-font);
    }
  `;
}
