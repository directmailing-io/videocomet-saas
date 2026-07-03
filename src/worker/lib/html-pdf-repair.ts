/**
 * Repariert das HTML das Google Drive fuer ein Google Doc ausgibt, damit
 * Floating-Overlap-Layouts (Bild in einer 2-Spalten-Container-Box) wieder
 * korrekt gerendert werden.
 *
 * Bug-Pattern (dokumentiert im Screenshot vom 2026-07-03):
 * Google Docs erlaubt Floating-Bilder, die visuell "in" einer Tabelle
 * liegen. Der HTML-Export flacht das aus:
 *   - Bild bekommt einen eigenen `<p>` VOR der Tabelle.
 *   - Die Zelle in der es visuell lag bleibt leer.
 * Resultat im PDF: Bild steht ueber der Box, Box wirkt einspaltig.
 *
 * Reparatur-Heuristik:
 *   1. Finde leere Table-Zellen (nur whitespace/empty span innen).
 *   2. Fuer jede: suche das naechstliegende `<p>` VOR der Tabelle das
 *      genau EIN `<img>` enthaelt und ansonsten nur Whitespace.
 *   3. Wenn gefunden, verschiebe das Bild in die leere Zelle und entferne
 *      den leeren `<p>`.
 *   4. Wende width:100% + height:auto auf das verschobene Bild an, damit
 *      es die Zelle ausfuellt statt seine Original-Pixel-Groesse zu behalten.
 *
 * Der Algorithmus ist rein strukturell — er fragt kein LLM, macht keine
 * Bilderkennung. Er nutzt die dokumentierte HTML-Layout-Konvention von
 * Google Drive fuer Floating-Bilder in Tabellenzellen.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";

export interface RepairReport {
  emptyCellsFound: number;
  imagesMovedIntoCells: number;
}

export function repairFloatingOverlaps(html: string): {
  html: string;
  report: RepairReport;
} {
  const $ = cheerio.load(html, { xmlMode: false, decodeEntities: false });

  let emptyCellsFound = 0;
  let imagesMovedIntoCells = 0;

  // Sammel alle leeren TDs (nur whitespace + leere spans).
  // Wichtig: wir gehen von HINTEN nach VORNE durch das Dokument. Grund:
  // wenn zwei leere Zellen in verschiedenen Tabellen existieren, soll die
  // spaetere Zelle auch das spaetere Bild bekommen (Reihenfolge stabil).
  const allEmptyCells: Element[] = [];
  $("td").each((_, td) => {
    if (isCellEmpty($, td)) allEmptyCells.push(td);
  });
  emptyCellsFound = allEmptyCells.length;

  // Fuer jede leere Zelle: finde das passende Bild-only <p> davor.
  // Wir suchen rueckwaerts vom umschliessenden <table>-Element aus, damit
  // Bilder die eindeutig VOR der Container-Box lagen zugeordnet werden.
  for (const cell of allEmptyCells) {
    const $cell = $(cell);
    const containingTable = $cell.closest("table");
    if (containingTable.length === 0) continue;

    const donor = findImageOnlyParagraphBefore($, containingTable[0]);
    if (!donor) continue;

    const $donor = $(donor.paragraph);
    const $img = $(donor.img);

    // Bild aus dem <span>-Wrapper von Google (display:inline-block mit fester
    // Pixel-Groesse) loesen und mit fluid-Style in die Zelle setzen.
    $img.attr("style", buildFluidImageStyle($img.attr("style") ?? ""));

    // Entferne existierenden leeren Inhalt der Zelle, dann Bild einsetzen.
    $cell.empty();
    $cell.append($img.clone());

    // Loesche den urspruenglichen <p>-Wrapper des Bildes komplett — sonst
    // rendert es doppelt.
    $donor.remove();

    imagesMovedIntoCells++;
  }

  return {
    html: $.html(),
    report: { emptyCellsFound, imagesMovedIntoCells },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isCellEmpty($: CheerioAPI, cell: Element): boolean {
  const $cell = $(cell);
  // Text-Content vollstaendig getrimmt
  const text = $cell.text().replace(/\s+/g, "").trim();
  if (text.length > 0) return false;
  // Keine echten Kind-Elemente ausser Whitespace/leere <p>/<span>
  const hasImage = $cell.find("img").length > 0;
  if (hasImage) return false;
  const hasSubTable = $cell.find("table").length > 0;
  if (hasSubTable) return false;
  return true;
}

interface Donor {
  paragraph: Element;
  img: Element;
}

/**
 * Sucht rueckwaerts vom `<table>`-Element im DOM nach einem `<p>` das
 * genau ein `<img>` und sonst nichts sichtbares enthaelt. "Rueckwaerts"
 * heisst: previousSibling-Kette, dann up-parent + previousSibling.
 * Wir stoppen wenn wir auf ein Element mit echtem Text-Content stossen —
 * das ist ein Vorgaenger-Absatz und gehoert nicht zu diesem Container.
 */
function findImageOnlyParagraphBefore(
  $: CheerioAPI,
  table: Element,
): Donor | null {
  let cursor: Element | null = table;
  while (cursor) {
    // Vorgaenger im gleichen Parent
    const prev = getPrevElementSibling(cursor);
    if (prev) {
      const donor = extractImageOnlyParagraph($, prev);
      if (donor) return donor;
      if (hasRealTextContent($, prev)) return null;
      cursor = prev;
      continue;
    }
    // Kein Vorgaenger mehr — nach oben
    const parent = cursor.parent && cursor.parent.type === "tag" ? (cursor.parent as Element) : null;
    if (!parent) return null;
    cursor = parent;
  }
  return null;
}

function getPrevElementSibling(el: Element): Element | null {
  let sib = el.prev;
  while (sib) {
    if (sib.type === "tag") return sib as Element;
    sib = sib.prev;
  }
  return null;
}

function extractImageOnlyParagraph(
  $: CheerioAPI,
  el: Element,
): Donor | null {
  // Das <p> selbst — oder ein <p> das der einzige nicht-triviale Nachfahre ist.
  const candidateParagraphs: Cheerio<Element> =
    el.name === "p" ? $(el) : $(el).find("p");
  for (const p of candidateParagraphs.toArray()) {
    const $p = $(p);
    const text = $p.text().replace(/\s+/g, "").trim();
    if (text.length > 0) continue;
    const imgs = $p.find("img");
    if (imgs.length !== 1) continue;
    return { paragraph: p, img: imgs[0] };
  }
  return null;
}

function hasRealTextContent($: CheerioAPI, el: Element): boolean {
  const text = $(el).text().replace(/\s+/g, "").trim();
  return text.length > 0;
}

/**
 * Baut ein fluid Bild-Style: fuellt die Container-Zelle aus, behaelt
 * Aspect-Ratio, keine max-Groesse durch harte px-Werte von Google.
 */
function buildFluidImageStyle(originalStyle: string): string {
  // Google's Export setzt width:XXX.XXpx; height:YYY.YYpx explizit.
  // Wir strippen die und lassen das <img> aus dem Zellen-Layout skalieren.
  const withoutSize = originalStyle
    .replace(/width\s*:\s*[^;]+;?/gi, "")
    .replace(/height\s*:\s*[^;]+;?/gi, "")
    .replace(/margin[^:]*:\s*[^;]+;?/gi, "")
    .trim();
  const prefix = withoutSize.length > 0 && !withoutSize.endsWith(";")
    ? withoutSize + ";"
    : withoutSize;
  return `${prefix}display:block;width:100%;height:auto;max-width:100%;`;
}
