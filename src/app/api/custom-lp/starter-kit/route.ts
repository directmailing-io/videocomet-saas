/**
 * Starter-Kit-Download.
 *
 * GET /api/custom-lp/starter-kit
 *   → streamt ein ZIP, das der Kunde als Ausgangspunkt für sein eigenes
 *     Custom-Landingpage-Template verwenden kann.
 *
 * Enthält:
 *   - index.html          (~80 Zeilen, Hero + Video-Slot + Primary-CTA)
 *   - style.css           (~150 Zeilen, sauberes Responsive-Layout)
 *   - script.js           (~30 Zeilen, demo der `window.videocomet.track`-API)
 *   - videocomet.json     (Manifest mit Platzhalter-Beispielen)
 *   - README.md           (Quickstart-Anleitung)
 *
 * Das ZIP wird komplett im Speicher gebaut (klein, < 50 KB), keine Filesystem-
 * I/O — funktioniert damit auch auf Edge / Hostinger-VPS gleichermaßen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import JSZip from "jszip";

const INDEX_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{firstName|Hallo}}, ein Video für Sie</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="hero">
    <header class="hero__eyebrow">
      <span class="badge">Persönliche Botschaft</span>
    </header>

    <h1 class="hero__title">
      {{firstName|Hallo}}, schön, dass Sie da sind.
    </h1>
    <p class="hero__subtitle">
      Wir haben dieses Video speziell für Sie aufgenommen.
      Nehmen Sie sich kurz Zeit — es lohnt sich.
    </p>

    <!--
      Das &lt;video&gt;-Element wird vom Element-Picker als "Video" markiert,
      damit die Tracking-Bridge play / progress-Events binden kann.
      Alternativ können Sie data-vc-video="primary" direkt setzen.
    -->
    <div class="video-wrap" data-vc-video="primary">
      <video
        controls
        preload="metadata"
        poster="https://picsum.photos/seed/poster/960/540"
      >
        <source src="" type="video/mp4" />
        Ihr Browser unterstützt das Video-Element nicht.
      </video>
    </div>

    <section class="cta">
      <h2 class="cta__title">Bereit für den nächsten Schritt?</h2>
      <p class="cta__text">
        Buchen Sie einen unverbindlichen Termin — ich freue mich auf Sie.
      </p>
      <a class="btn btn--primary" data-vc-cta="primary" href="#kontakt">
        Jetzt Termin buchen
      </a>
      <a class="btn btn--ghost" data-vc-cta="secondary" href="mailto:{{email|hello@example.com}}">
        Per E-Mail antworten
      </a>
    </section>
  </main>

  <footer class="footer">
    <p>&copy; {{companyName|Ihre Firma}} &middot; Mit VIDEOCOMET erstellt.</p>
  </footer>

  <script src="script.js" defer></script>
</body>
</html>
`;

const STYLE_CSS = `/* ── Reset & Base ───────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
    Arial, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  color: #0f172a;
  background: #f8fafc;
  -webkit-font-smoothing: antialiased;
}
img, video { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

/* ── Hero ───────────────────────────────────────────────────────── */
.hero {
  max-width: 920px;
  margin: 0 auto;
  padding: 56px 24px 32px;
}
.hero__eyebrow { margin-bottom: 16px; }
.badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4f46e5;
  background: #eef2ff;
  padding: 4px 12px;
  border-radius: 999px;
}
.hero__title {
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 12px;
}
.hero__subtitle {
  font-size: 17px;
  color: #475569;
  max-width: 640px;
  margin: 0 0 32px;
}

/* ── Video-Wrap (16:9 fluid) ───────────────────────────────────── */
.video-wrap {
  aspect-ratio: 16 / 9;
  background: #0f172a;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 50px -20px rgba(15, 23, 42, 0.35);
  margin-bottom: 40px;
}
.video-wrap video {
  width: 100%; height: 100%; object-fit: cover;
}

/* ── CTA-Section ───────────────────────────────────────────────── */
.cta {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 32px;
  text-align: center;
}
.cta__title {
  font-size: 22px; font-weight: 700; margin: 0 0 8px;
}
.cta__text {
  font-size: 15px; color: #475569; margin: 0 0 20px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  padding: 0 24px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 15px;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.btn:hover { transform: translateY(-1px); }
.btn--primary {
  background: #4f46e5; color: #ffffff;
  box-shadow: 0 8px 20px -8px rgba(79, 70, 229, 0.5);
  margin-right: 8px;
}
.btn--primary:hover { background: #4338ca; }
.btn--ghost {
  background: transparent; color: #4f46e5; border: 1px solid #c7d2fe;
}

/* ── Footer ────────────────────────────────────────────────────── */
.footer {
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
  padding: 32px 24px 48px;
}

/* ── Mobile ────────────────────────────────────────────────────── */
@media (max-width: 540px) {
  .hero { padding: 32px 20px 20px; }
  .cta { padding: 24px 20px; }
  .btn { width: 100%; margin: 6px 0 !important; }
}
`;

const SCRIPT_JS = `/**
 * Demo: window.videocomet.track-API
 *
 * Die VIDEOCOMET-Tracking-Bridge injiziert ein globales Objekt
 * \`window.videocomet\`. Sie können damit eigene Events feuern, ohne dass
 * Sie auf die Custom-LP-Annotations angewiesen sind.
 *
 * Verfügbar (sobald die Seite via VIDEOCOMET ausgeliefert wird):
 *   window.videocomet.track(eventName, payload?)
 *   window.videocomet.lead   → { firstName, lastName, ... }
 *   window.videocomet.session
 */
(function () {
  function vc() {
    return window.videocomet || null;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var primary = document.querySelector('[data-vc-cta="primary"]');
    if (primary) {
      primary.addEventListener("click", function () {
        if (vc()) vc().track("primary_cta_clicked");
      });
    }
  });
})();
`;

const VIDEOCOMET_JSON = `{
  "name": "Mein Custom-Template",
  "version": "1.0.0",
  "entry": "index.html",
  "placeholders": {
    "firstName": { "type": "string", "example": "Peter" },
    "lastName": { "type": "string", "example": "Mueller" },
    "companyName": { "type": "string", "example": "Mueller GmbH" },
    "email": { "type": "string", "example": "peter@example.com" }
  },
  "annotations": {
    "videoSelector": "[data-vc-video=\\"primary\\"] video",
    "primaryCta": "[data-vc-cta=\\"primary\\"]",
    "secondaryCta": "[data-vc-cta=\\"secondary\\"]"
  }
}
`;

const README_MD = `# VIDEOCOMET Custom-Landingpage Starter-Kit

Willkommen! Dieses ZIP ist der schnellste Weg zu Ihrer eigenen, personalisierten
Landingpage in VIDEOCOMET.

## Inhalt

- \`index.html\` — die Seite selbst (Hero + Video + CTAs)
- \`style.css\` — sauberes, responsives Layout
- \`script.js\` — Beispiel für die \`window.videocomet.track\`-API
- \`videocomet.json\` — Manifest mit Placeholder-Beschreibungen
- \`README.md\` — dieses Dokument

## Quickstart

1. Entpacken Sie das ZIP, passen Sie die Inhalte an.
2. Verwenden Sie \`{{firstName}}\`, \`{{lastName|Fallback}}\` etc. überall, wo
   personalisierte Inhalte erscheinen sollen.
3. Markieren Sie Ihr Haupt-Video mit \`data-vc-video="primary"\`.
4. Markieren Sie Ihren primären CTA mit \`data-vc-cta="primary"\`,
   den sekundären mit \`data-vc-cta="secondary"\`.
5. Packen Sie alles wieder zu einem ZIP zusammen.
6. Laden Sie das ZIP in VIDEOCOMET unter
   **Landingpages → Eigene HTML-Vorlagen** hoch.

## Tipps

- Externe Scripts (\`<script src="https://…">\`) sind erlaubt, werden in der
  Sandbox aber im Vorschau-Modus oft blockiert.
- Maximale ZIP-Größe: 50 MB.
- Erlaubte Dateitypen: HTML, CSS, JS, JSON, SVG, PNG, JPG, WEBP, GIF, ICO,
  Fonts (WOFF/WOFF2/TTF/OTF), Video (MP4/WEBM/VTT).
- Verwenden Sie ausschließlich relative Pfade — die Sandbox serviert Ihre
  Assets unter einem eindeutigen Slug.

## Personalisierungs-Felder

Sie können beliebige Lead-Felder über \`{{Schlüssel}}\` einbinden.
Standard-Felder:

| Schlüssel       | Beispiel              |
|-----------------|-----------------------|
| \`firstName\`     | Peter                 |
| \`lastName\`      | Mueller               |
| \`fullName\`      | Peter Mueller         |
| \`companyName\`   | Mueller GmbH          |
| \`email\`         | peter@example.com     |
| \`phone\`         | +49 30 12345678       |

Fallbacks gehen mit \`{{firstName|Hallo}}\`.

---

Viel Erfolg!
Ihr VIDEOCOMET-Team
`;

export async function GET() {
  const zip = new JSZip();
  zip.file("index.html", INDEX_HTML);
  zip.file("style.css", STYLE_CSS);
  zip.file("script.js", SCRIPT_JS);
  zip.file("videocomet.json", VIDEOCOMET_JSON);
  zip.file("README.md", README_MD);

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // Convert to ArrayBuffer for the Response body — Buffer extends Uint8Array
  // which itself satisfies BodyInit.
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="videocomet-starter-kit.zip"',
      "cache-control": "public, max-age=3600",
    },
  });
}
