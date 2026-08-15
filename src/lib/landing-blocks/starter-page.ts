/**
 * Vorbefüllte Startseite für neue Landingpage-Vorlagen (Editor-Redesign
 * 2026-08: Hero-first). Der User beginnt mit EINER fertigen Hero-Sektion
 * (Video zentriert, persönliche Ansprache) statt mit fünf vorgefüllten
 * Blöcken — weitere Sektionen fügt er gezielt über die Plus-Linien im
 * Canvas hinzu. Das hält den Einstieg unter fünf Minuten und vermeidet
 * das "Was ist das alles?"-Gefühl beim ersten Öffnen.
 *
 * Die Texte sind generische, sinnvolle deutsche Beispieltexte in Du-Form
 * mit Platzhaltern (Syntax siehe `placeholders.ts`: `{{key|fallback}}`;
 * `vorname` wird case-insensitiv auf die Vorname-Spalte des CSVs
 * aufgelöst).
 *
 * Reine Funktion ohne Dependencies — server- und client-safe, damit der
 * Wizard (Client) und mögliche Server-Pfade dieselben Blöcke erzeugen.
 */

import type { Block } from "./types";

/**
 * Baut den Starter-Block (nur Hero). Die IDs sind pro Aufruf frisch,
 * damit mehrfach angelegte Vorlagen (und spätere Block-Duplikate)
 * niemals ID-Kollisionen erben.
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
  ];
}

/** Kurze, kollisionsarme Block-ID — gleiche Konvention wie der Editor. */
function starterId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
