/**
 * Play-Icon-Overlay-Composite via Sharp.
 *
 * Wenn der User in der Kampagne `thumbnailPlayIcon=true` aktiviert hat,
 * bekommt JEDES generierte Thumbnail-PNG einen halbtransparenten
 * Play-Button-Overlay (zentriert, ~30 % der Buehnenbreite) — optisch wie
 * typische YouTube/Vimeo-Posters.
 *
 * Implementierungsdetails:
 * - Das Overlay ist ein statisches Inline-SVG (dunkler Kreis + weisses
 *   Dreieck), das wir zur Laufzeit auf die gewuenschte Pixelbreite
 *   rasterisieren. Inline-SVG statt File-Load, damit das Modul auch in
 *   gebauten Workern (z. B. esbuild-Bundle ohne Asset-Plugin) verlaesslich
 *   funktioniert.
 * - Best-Effort: faellt das Composite aus irgendeinem Grund hin
 *   (kaputtes Input-PNG, Sharp-Runtime-Error, …), kopieren wir den Input
 *   1:1 nach Output, loggen eine Warning, und werfen NICHT — die Pipeline
 *   soll weiterlaufen, auch wenn das Overlay mal fehlt.
 *
 * NICHT-Idempotent: Zweimaliges Anwenden uebereinander legt das Overlay
 * doppelt und macht es dunkler. Pipeline darf die Funktion pro Thumbnail
 * nur einmal aufrufen.
 */

import { copyFile, readFile } from "node:fs/promises";
import sharp from "sharp";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

/** Anteil der Buehnenbreite, den das Play-Icon einnimmt. */
const ICON_WIDTH_RATIO = 0.3;

/**
 * Inline-SVG fuer das Play-Icon.
 * - Kreis: 55 % opaque schwarz (=> 45 % transparent), Radius 90 von 200 viewport
 * - Dreieck: weiss, equilateral-aehnlich, leicht nach rechts versetzt fuer
 *   optisches Gleichgewicht (die Spitze sitzt nicht exakt auf cx)
 */
const PLAY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="90" fill="rgba(0,0,0,0.55)" />
  <path d="M 80 60 L 80 140 L 145 100 Z" fill="white" />
</svg>`;

export interface ApplyPlayIconOverlayInput {
  /** Pfad zum Original-Thumbnail-PNG. */
  inputPngPath: string;
  /** Pfad fuer Output (kann gleich `inputPngPath` sein). */
  outputPngPath: string;
  /** Optional override; default 1280. */
  width?: number;
  /** Default 720 — nur fuer Symmetrie mit width; Sharp benutzt das Input-PNG-Dim. */
  height?: number;
}

/**
 * Ueberlagert ein bestehendes Thumbnail-PNG mit einem zentrierten Play-Icon.
 *
 * Bei Fehlern (Sharp nicht verfuegbar, Input kaputt) wird der Input nach
 * Output kopiert und eine Warning geloggt — die Pipeline laeuft weiter
 * (Best-Effort).
 */
export async function applyPlayIconOverlay(
  input: ApplyPlayIconOverlayInput,
): Promise<void> {
  const width = input.width ?? DEFAULT_WIDTH;
  // height ist aktuell nicht in der Composite-Logik benoetigt (Sharp behaelt die
  // Input-PNG-Dimensionen), aber Teil des Public-Interfaces. Wir referenzieren
  // ihn hier, damit der Default-Pfad konsistent typgepruefte Werte erzeugt.
  void (input.height ?? DEFAULT_HEIGHT);

  try {
    const iconWidth = Math.max(1, Math.round(ICON_WIDTH_RATIO * width));
    const iconBuf = await sharp(Buffer.from(PLAY_ICON_SVG))
      .resize({ width: iconWidth })
      .png()
      .toBuffer();

    // Sharp refuses to write to the same file it's reading from. Wenn
    // Input- und Output-Pfad identisch sind (in-place overlay), lesen
    // wir den Input erst in einen Buffer ein, damit die Pipe sicher
    // geschlossen ist, bevor `toFile` zurueckschreibt.
    const sourceForComposite: string | Buffer =
      input.inputPngPath === input.outputPngPath
        ? await readFile(input.inputPngPath)
        : input.inputPngPath;

    await sharp(sourceForComposite)
      .composite([{ input: iconBuf, gravity: "center" }])
      .png()
      .toFile(input.outputPngPath);
  } catch (err) {
    console.warn(
      "[play-icon-overlay] composite failed; copying input without overlay:",
      err,
    );
    await safeCopy(input.inputPngPath, input.outputPngPath);
  }
}

/**
 * Kopiert Input -> Output, nur wenn die Pfade unterschiedlich sind. Schluckt
 * Fehler beim Kopieren ebenfalls (loggt Warning), damit der aufrufende
 * Pipeline-Step keinesfalls von dieser Best-Effort-Funktion crasht.
 */
async function safeCopy(src: string, dst: string): Promise<void> {
  if (src === dst) return;
  try {
    await copyFile(src, dst);
  } catch (err) {
    console.warn("[play-icon-overlay] fallback copy failed:", err);
  }
}
