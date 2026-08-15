"use client";

/**
 * Sektions-Galerie des Canvas-Builders (Konzept 6.1): Das „+" zwischen
 * Sektionen öffnet dieses Overlay. Jeder Sektionstyp wird als Karte mit
 * einer ECHTEN Vorschau im eigenen Markenlook angezeigt: Der Block wird
 * mit seinen Default-Daten (plus Beispiel-Overrides für sonst leere
 * Blöcke) innerhalb des LandingThemeProviders gerendert und per
 * transform: scale() auf Kartengröße verkleinert.
 *
 * Gruppierung nach Zweck (Konzept): Überzeugen / Erklären / Abschluss.
 */

import * as React from "react";

import { BLOCK_REGISTRY } from "@/components/landing-blocks";
import { LandingThemeProvider } from "@/components/landing-blocks/theme-provider";
import type { BlockType } from "@/lib/landing-blocks/types";
import type { BrandConfig, ThemeConfig } from "@/lib/landing-theme/types";
import { cn } from "@/lib/utils";

import { BLOCK_LABELS } from "../_editor/inspector-fields";
import { makeDefaultBlock } from "../_editor/state";

export interface AddGalleryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (type: BlockType) => void;
  /** Für die Marken-Vorschau der Miniaturen. */
  theme: ThemeConfig;
  brand: BrandConfig;
}

/* ------------------------------------------------------------------ */
/* Beispieldaten                                                       */
/* ------------------------------------------------------------------ */

/** Gleicher Beispiel-Lead wie in der Editor-Vorschau (lp-preview.tsx). */
const SAMPLE_LEAD: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  company: "Mustermann GmbH",
  email: "max@mustermann.de",
  jobTitle: "Geschäftsführer",
};

/** Neutrales SVG-Platzhalterbild als data-URI (kein Netzwerk nötig). */
function svgDataUri(width: number, height: number, label: string): string {
  const fontSize = Math.max(12, Math.round(height / 7));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" rx="10" fill="#e4e3e9"/>` +
    `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="sans-serif" font-weight="600" font-size="${fontSize}" fill="#8b8894">${label}</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/**
 * Overrides pro Blocktyp für Blöcke, deren makeDefaultBlock-Daten leer
 * rendern würden (return null). Nur für die Galerie-Vorschau; eingefügt
 * wird immer der echte Default-Block.
 */
const PREVIEW_DATA: Partial<Record<BlockType, Record<string, unknown>>> = {
  testimonials: {
    items: [
      {
        quote: "Sehr empfehlenswert, hat uns enorm geholfen.",
        author: "Max Mustermann",
        role: "Geschäftsführer",
      },
      {
        quote: "Schnell, unkompliziert und persönlich.",
        author: "Erika Beispiel",
        role: "Marketing",
      },
      {
        quote: "Würden wir jederzeit wieder machen.",
        author: "Jonas Muster",
        role: "Vertrieb",
      },
    ],
  },
  faq: {
    items: [
      {
        q: "Wie schnell kann ich starten?",
        a: "Sofort. Du brauchst keine Vorkenntnisse und keine Einrichtung.",
      },
      {
        q: "Was kostet mich das?",
        a: "Du zahlst nur, was du wirklich nutzt. Keine versteckten Kosten.",
      },
    ],
  },
  content: {
    headline: "So läuft die Zusammenarbeit",
    body:
      "Wir begleiten dich Schritt für Schritt zum Ergebnis.\n\n" +
      "- Persönliche Betreuung\n- Schnelle Umsetzung",
    image: { url: svgDataUri(640, 420, "Grafik"), alt: "Beispielgrafik" },
  },
  "case-study": {
    headline: "So haben wir Kunden geholfen",
    client: { name: "Beispiel GmbH", logoUrl: "", photoUrl: "" },
    medium: { kind: "image", url: svgDataUri(640, 420, "Projekt"), alt: "" },
    textMode: "structured",
    quote: {
      text: "Die Zusammenarbeit hat sich sofort ausgezahlt.",
      author: "Max Mustermann",
      role: "Geschäftsführer",
    },
    structured: {
      situation: "Zu wenig qualifizierte Anfragen über die Website.",
      action: "Neue Landingpage mit persönlichem Video eingeführt.",
      result: "Deutlich mehr Rückmeldungen in kurzer Zeit.",
      kpi: "+42 % Antwortquote",
    },
  },
  "rich-text": {
    markdown:
      "Hier kannst du frei formulieren: Erkläre dein Angebot, " +
      "beantworte Rückfragen oder ergänze Details, die deinem Lead " +
      "die Entscheidung leichter machen.",
  },
  image: {
    url: svgDataUri(880, 420, "Bild"),
    alt: "Beispielbild",
    caption: "Eine Bildunterschrift (optional)",
    fullWidth: false,
  },
};

/* ------------------------------------------------------------------ */
/* Gruppen                                                             */
/* ------------------------------------------------------------------ */

/**
 * Angebotene Sektionstypen (kuratiert 2026-08-15): Kunden-Logos, Stats,
 * Über mich und Abstand sind bewusst NICHT mehr wählbar — bestehende
 * Seiten mit diesen Blöcken rendern weiter (Renderer bleiben registriert).
 */
const GROUPS: { title: string; types: BlockType[] }[] = [
  {
    title: "Überzeugen",
    types: ["case-study", "testimonials"],
  },
  {
    title: "Erklären",
    types: ["content", "image", "rich-text", "faq"],
  },
  {
    title: "Abschluss",
    types: ["cta-banner"],
  },
];

/** Kurzbeschreibung pro Sektionstyp für die Listen-Ansicht. */
const TYPE_DESCRIPTIONS: Partial<Record<BlockType, string>> = {
  "case-study": "Ein Kundenprojekt mit Ausgangslage, Lösung und messbarem Ergebnis.",
  testimonials: "Zitate zufriedener Kunden als Vertrauensbeweis.",
  content: "Text plus Bild oder Video nebeneinander — erklär dein Angebot im Detail.",
  image: "Ein großes Bild oder ein eingebettetes Video (YouTube, Vimeo, Wistia …).",
  "rich-text": "Frei formulierter Text, wahlweise mit Headline, zentriert oder linksbündig.",
  faq: "Beantworte die häufigsten Rückfragen direkt auf der Seite.",
  "cta-banner": "Der nächste Schritt: Button, Terminkalender oder Kontaktformular.",
};

/** Breite des unskalierten Vorschau-Containers. */
const PREVIEW_WIDTH = 880;
/** Skalierungsfaktor auf Thumbnail-Größe (~290px breit). */
const PREVIEW_SCALE = 0.33;
/** Sichtbare Höhe der Miniatur. */
const PREVIEW_HEIGHT = 128;

/* ------------------------------------------------------------------ */
/* Galerie                                                             */
/* ------------------------------------------------------------------ */

export function AddGallery({
  open,
  onClose,
  onAdd,
  theme,
  brand,
}: AddGalleryProps) {
  // Escape schließt das Overlay.
  React.useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Logo/Footer in den Miniaturen ausblenden: Der Markenlook kommt aus
  // Farben, Fonts und Radius, nicht aus dem Header-Chrome.
  const previewBrand = React.useMemo<BrandConfig>(
    () => ({ ...brand, logoUrl: null }),
    [brand],
  );

  // Performance: Galerie (11 skalierte Block-Renderings) nur im offenen
  // Zustand mounten.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40"
        aria-hidden
        onClick={onClose}
      />
      {/* Karte */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sektion hinzufügen"
        className="relative flex w-full max-w-4xl max-h-[85vh] flex-col rounded-squircle-lg bg-surface shadow-lift overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-6 py-4 shrink-0">
          <h2 className="text-lg font-bold text-ink">Sektion hinzufügen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Galerie schließen"
            className="flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-7 last:mb-0">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-3">
                {group.title}
              </h3>
              <div className="flex flex-col gap-3">
                {group.types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      onAdd(type);
                      onClose();
                    }}
                    className={cn(
                      "group flex items-stretch gap-0 overflow-hidden rounded-squircle-md border border-line bg-surface text-left",
                      "shadow-card transition-all hover:border-brand hover:shadow-card-hover",
                    )}
                  >
                    <div className="w-[290px] shrink-0 border-r border-line">
                      <BlockPreview
                        type={type}
                        theme={theme}
                        brand={previewBrand}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-ink group-hover:text-brand-deep transition-colors">
                          {BLOCK_LABELS[type]}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
                          {TYPE_DESCRIPTIONS[type]}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full",
                          "bg-surface-soft text-ink-muted transition-colors",
                          "group-hover:bg-brand-soft group-hover:text-brand-deep",
                        )}
                        aria-hidden
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M7 2v10M2 7h10"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Miniatur im Markenlook                                              */
/* ------------------------------------------------------------------ */

function BlockPreview({
  type,
  theme,
  brand,
}: {
  type: BlockType;
  theme: ThemeConfig;
  brand: BrandConfig;
}) {
  const block = React.useMemo(() => {
    const fresh = makeDefaultBlock(type);
    const overrides = PREVIEW_DATA[type];
    return overrides
      ? { ...fresh, data: { ...fresh.data, ...overrides } }
      : fresh;
  }, [type]);

  const Component = BLOCK_REGISTRY[type];
  if (!Component) return null;

  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden bg-surface-soft pointer-events-none select-none"
      style={{ height: PREVIEW_HEIGHT }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: PREVIEW_WIDTH,
          transform: `scale(${PREVIEW_SCALE})`,
        }}
      >
        <LandingThemeProvider theme={theme} brand={brand} showFooter={false}>
          <Component
            data={block.data}
            style={block.style}
            variant={block.variant}
            theme={theme as unknown as Record<string, unknown>}
            leadData={SAMPLE_LEAD}
            leadId="preview"
            slot={type === "hero" ? <HeroVideoStub /> : undefined}
          />
        </LandingThemeProvider>
      </div>
    </div>
  );
}

/** Graues Video-Stub-Rechteck für den Hero-Slot. */
function HeroVideoStub() {
  return (
    <div className="aspect-video w-full max-w-2xl mx-auto rounded-2xl bg-ink/15" />
  );
}
