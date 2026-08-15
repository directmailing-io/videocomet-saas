/**
 * Vorbefüllte Standardseite für neue Landingpage-Vorlagen (Konzept v3,
 * Abschnitt 2): Der User landet nach dem Einstiegs-Wizard NIE in einem
 * leeren Editor, sondern sieht sofort eine fertig gestaltete Seite in
 * seinem Markenlook — Hero (Video zentriert) → Content → Rezensionen →
 * FAQ → CTA.
 *
 * Die Texte sind bewusst generische, aber sinnvolle deutsche Beispiel-
 * texte in Du-Form mit Platzhaltern (Syntax siehe `placeholders.ts`:
 * `{{key|fallback}}`; `vorname` wird von der zentralen Substitution
 * case-insensitiv auf die Vorname-Spalte des CSVs aufgelöst).
 *
 * Reine Funktion ohne Dependencies — server- und client-safe, damit der
 * Wizard (Client) und mögliche Server-Pfade dieselben Blöcke erzeugen.
 */

import type { Block } from "./types";

/**
 * Baut die fünf Starter-Blöcke. Die IDs sind pro Aufruf frisch, damit
 * mehrfach angelegte Vorlagen (und spätere Block-Duplikate) niemals
 * ID-Kollisionen erben.
 */
export function buildStarterBlocks(): Block[] {
  return [
    {
      id: starterId("hero"),
      type: "hero",
      data: {
        headline: "{{vorname|Hallo}}, dieses Video ist nur für dich",
        subheadline:
          "Ich habe es persönlich für dich aufgenommen. Nimm dir zwei Minuten und schau es dir in Ruhe an.",
        alignment: "center",
        showVideo: true,
      },
    },
    {
      id: starterId("rich"),
      type: "rich-text",
      data: {
        markdown:
          "**Warum ich mich bei dir melde**\n\n" +
          "Ich habe mir {{firma|dein Unternehmen}} genauer angesehen und glaube, dass wir gemeinsam einiges bewegen können. Im Video erkläre ich dir kurz:\n\n" +
          "- was mir bei euch aufgefallen ist\n" +
          "- welche konkrete Idee ich für dich habe\n" +
          "- wie der nächste Schritt aussehen könnte\n\n" +
          "Kein Standard-Pitch, versprochen: Alles im Video bezieht sich direkt auf dich.",
      },
    },
    {
      id: starterId("testi"),
      type: "testimonials",
      data: {
        items: [
          {
            quote:
              "Die Zusammenarbeit war unkompliziert und das Ergebnis hat unsere Erwartungen übertroffen. Klare Empfehlung.",
            author: "Sandra Weber",
            role: "Geschäftsführerin, Beispiel GmbH",
            avatar: "",
          },
          {
            quote:
              "Endlich jemand, der zuhört und dann liefert. Nach vier Wochen hatten wir die ersten messbaren Ergebnisse.",
            author: "Markus Klein",
            role: "Leiter Vertrieb, Muster AG",
            avatar: "",
          },
        ],
      },
    },
    {
      id: starterId("faq"),
      type: "faq",
      data: {
        items: [
          {
            q: "Wie läuft die Zusammenarbeit ab?",
            a: "Wir starten mit einem kurzen Kennenlern-Gespräch. Danach bekommst du einen konkreten Vorschlag mit klaren nächsten Schritten, ganz ohne Verpflichtung.",
          },
          {
            q: "Was kostet das Ganze?",
            a: "Das hängt von deinem Ziel ab. Im ersten Gespräch klären wir, was du brauchst, und du bekommst ein transparentes Angebot ohne versteckte Kosten.",
          },
          {
            q: "Wie schnell können wir loslegen?",
            a: "In der Regel innerhalb weniger Tage. Buch dir einfach unten einen Termin, dann besprechen wir alles Weitere.",
          },
        ],
      },
    },
    {
      id: starterId("cta"),
      type: "cta-banner",
      data: {
        headline: "Lass uns sprechen",
        subheadline:
          "Buch dir einen unverbindlichen Termin. Ich freue mich auf dich.",
        primaryButton: { label: "Termin buchen", url: "" },
        secondaryButton: { label: "", url: "" },
      },
    },
  ];
}

/** Kurze, kollisionsarme Block-ID — gleiche Konvention wie der Editor. */
function starterId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
