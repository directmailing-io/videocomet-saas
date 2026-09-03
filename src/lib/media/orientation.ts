/**
 * Zentrale Format-Logik für Videos (Mediathek, Wizard, Recorder, Vorschauen).
 *
 * Vorher gab es vier lokale Kopien (Worker, Kampagnen-Detail, LP-Player,
 * Wizard-Badge) mit drei Konventionen. Hier ist EINE Quelle: Format aus
 * Pixelmaßen ableiten und daraus Tailwind-Klassen für den Container.
 *
 * Regel für Videos: NIE `object-cover` (schneidet Hochkant-Videos ab),
 * immer `object-contain` in einem Container, dessen Seitenverhältnis dem
 * Video folgt. Unbekannte Maße (Legacy-Items) → 16:9.
 */

export type VideoOrientation = "landscape" | "portrait" | "square";

export function orientationFromDims(
  width: number | null | undefined,
  height: number | null | undefined,
): VideoOrientation | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

export function isPortraitDims(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  return orientationFromDims(width, height) === "portrait";
}

export function orientationLabel(o: VideoOrientation | null): string | null {
  if (o === "portrait") return "Hochformat";
  if (o === "landscape") return "Querformat";
  if (o === "square") return "Quadratisch";
  return null;
}

/**
 * Tailwind-Aspect-Klasse für einen Video-Container. Hochkant bekommt eine
 * Breitenbegrenzung, damit es nicht bildschirmhoch wird.
 */
export function aspectClassFor(
  o: VideoOrientation | null,
  opts: { portraitMaxWidth?: string } = {},
): string {
  const maxW = opts.portraitMaxWidth ?? "max-w-[280px]";
  if (o === "portrait") return `aspect-[9/16] ${maxW} mx-auto`;
  if (o === "square") return "aspect-square max-w-[360px] mx-auto";
  return "aspect-video w-full";
}
