"use client";

/**
 * Kopierbare KI-Prompt-Vorlage für Custom-HTML-Landingpages.
 *
 * Der Kunde fügt den Prompt in Claude/ChatGPT ein, ergänzt unten seine
 * Angaben und bekommt eine Landingpage, die alle VIDEOCOMET-Regeln einhält
 * (Platzhalter-Syntax, Video-Slot, Tracking-Marker, Sanitizer-Verbote,
 * ZIP-Limits). Die Regeln müssen synchron bleiben mit:
 *   - renderer.ts (Platzhalter, Video-Inject, --vc-video-aspect)
 *   - sanitizer.ts (on*-Attribute, javascript:, meta refresh, <base>)
 *   - zip-validator.ts / types.ts (Endungen, Limits, index.html-Regel)
 *   - __videocomet-bridge.js (data-vc-cta, window.videocomet.track)
 */

import * as React from "react";
import { ChevronDown, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

export const KI_PROMPT = `Du bist ein erfahrener Webentwickler und Conversion-Designer. Erstelle eine statische, personalisierte Video-Landingpage, die ich als ZIP bei VIDEOCOMET hochlade. VIDEOCOMET liefert die Seite pro Empfänger aus: Platzhalter werden serverseitig ersetzt, das persönliche Video wird automatisch eingesetzt und das Tracking wird automatisch injiziert.

Halte dich exakt an diese Regeln:

## Technik & Dateistruktur
- Nur statisches HTML/CSS/JS. Kein Build-Tool, kein Framework, kein Server-Code.
- Einstiegsdatei "index.html" im Stammverzeichnis des ZIP (oder in genau einem obersten Ordner).
- Ausschließlich relative Pfade (z. B. "style.css", "img/logo.png"). Keine absoluten Pfade, keine ".."-Segmente.
- Kein <base>-Tag und kein <meta http-equiv="refresh"> (werden beim Upload entfernt).
- Erlaubte Dateitypen: html, htm, css, js, mjs, json, svg, png, jpg, jpeg, webp, avif, gif, ico, woff, woff2, ttf, otf, mp4, webm, vtt. Alle anderen Dateien werden abgelehnt.
- Limits: ZIP max. 50 MB, entpackt max. 200 MB, max. 2.000 Dateien.
- Externe Ressourcen (Fonts, CDNs) nur über https. Besser: alles lokal mit ins ZIP legen.

## Kein Inline-JavaScript in Attributen
- NIEMALS "onclick", "onload" oder andere "on…"-Attribute und keine "javascript:"-Links verwenden. Sie werden beim Upload automatisch entfernt und die Funktion wäre weg.
- Interaktivität ausschließlich über addEventListener in einer eigenen .js-Datei.

## Personalisierung (Text-Platzhalter)
- Platzhalter im Format {{spaltenname}} oder mit Fallback {{spaltenname|Fallback-Text}}.
- Die Namen entsprechen EXAKT den Spaltenüberschriften meiner Lead-Liste (Groß-/Kleinschreibung beachten). Meine Spalten stehen unten unter "Meine Angaben".
- Platzhalter funktionieren in Texten und Attributen (alt, title, href, …), aber NICHT innerhalb von <script>- oder <style>-Blöcken.
- Zusätzlicher System-Platzhalter: {{pageUrl}} = die kurze Web-Adresse dieser persönlichen Seite.
- Setze immer einen Fallback, wenn ein Feld leer sein könnte, z. B. {{vorname|Hallo}}.

## Video-Platzhalter (wichtig!)
- Baue GENAU EINEN Video-Bereich prominent im sofort sichtbaren Bereich:

  <div class="video-wrap" data-vc-video="primary">
    <video controls preload="metadata" poster="">
      <source src="" type="video/mp4" />
    </video>
  </div>

- "src" und "poster" LEER lassen. VIDEOCOMET setzt pro Empfänger automatisch das persönliche Video und Vorschaubild ein.
- Das Seitenverhältnis wird automatisch über die CSS-Variable --vc-video-aspect gesetzt. Style den Container so:
  .video-wrap { aspect-ratio: var(--vc-video-aspect, 16 / 9); }
  .video-wrap video { width: 100%; height: 100%; object-fit: cover; }
- Kein hartkodiertes Seitenverhältnis mit !important dagegensetzen.

## Tracking (läuft automatisch — nur markieren)
- Markiere den Haupt-Button/-Link mit data-vc-cta="primary", einen zweiten mit data-vc-cta="secondary". Weitere Buttons dürfen beliebige Werte bekommen, z. B. data-vc-cta="footer".
- Seitenaufrufe, Video-Abspielfortschritt und Klicks auf markierte Elemente werden dann automatisch getrackt. KEIN eigenes Analytics-Script einbauen.
- Optional eigene Events: if (window.videocomet) window.videocomet.track("mein_event");

## Design
- Responsive und mobile-first: <meta name="viewport" content="width=device-width, initial-scale=1">. Die Seite muss von 360 px bis 1440 px Breite überzeugend aussehen.
- Sprache Deutsch, <html lang="de">.
- Klare Struktur: persönliche Begrüßung mit Platzhalter, Video, Nutzenargumente, Call-to-Action, Footer mit Impressum- und Datenschutz-Link.

## Abgabe
- Liefere alle Dateien vollständig aus (index.html, style.css, script.js, ggf. Bilder), damit ich sie 1:1 als ZIP packen und hochladen kann.

---

## Meine Angaben (bitte vor dem Absenden ergänzen)
- Firma / Absender: [z. B. Mustermann GmbH]
- Branche & Angebot: [Was biete ich an? Für wen?]
- Ziel der Seite: [z. B. Termin buchen]
- Link für den Haupt-Button: [z. B. Calendly-Link]
- Farben / Stil / Logo: [z. B. Dunkelblau, modern; Logo liegt als logo.png bei]
- Spalten meiner Lead-Liste: [z. B. vorname, nachname, firma, email]
- Impressum-URL: [Link] / Datenschutz-URL: [Link]
- Sonstige Wünsche: [optional]
`;

export function CopyKiPromptButton({
  variant = "ghost",
  size,
  className,
}: {
  variant?: "ghost" | "subtle" | "brand";
  size?: "sm";
  className?: string;
}) {
  const { toast } = useToast();

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(KI_PROMPT);
      toast({
        title: "Prompt kopiert",
        description:
          "Fügen Sie ihn in Claude oder ChatGPT ein und ergänzen Sie unten Ihre Angaben.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Kopieren fehlgeschlagen",
        description: "Bitte markieren und kopieren Sie den Text manuell.",
        variant: "danger",
      });
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      iconLeft={<Copy className="size-4" />}
      onClick={() => void onCopy()}
    >
      KI-Prompt kopieren
    </Button>
  );
}

/**
 * Karte mit Erklärung, Copy-Button und aufklappbarer Prompt-Vorschau —
 * für die "Neue HTML-Vorlage"-Seite.
 */
export function KiPromptCard() {
  const [open, setOpen] = React.useState(false);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              Landingpage von einer KI bauen lassen?
            </h3>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Kopieren Sie unsere Prompt-Vorlage mit allen Regeln (Platzhalter,
              Video, Tracking, Responsive), fügen Sie sie in Claude oder ChatGPT
              ein und ergänzen Sie Ihre Angaben.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <CopyKiPromptButton variant="subtle" size="sm" />
              <Button
                variant="ghost"
                size="sm"
                iconLeft={
                  <ChevronDown
                    className={
                      open
                        ? "size-4 rotate-180 transition-transform"
                        : "size-4 transition-transform"
                    }
                  />
                }
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Verbergen" : "Ansehen"}
              </Button>
            </div>
          </div>
        </div>
        {open && (
          <pre className="mt-4 max-h-72 overflow-auto rounded-squircle-sm border border-line-soft bg-surface-muted p-3 text-[11px] leading-relaxed text-ink whitespace-pre-wrap font-mono">
            {KI_PROMPT}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
