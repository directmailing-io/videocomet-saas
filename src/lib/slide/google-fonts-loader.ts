"use client";

/**
 * Dynamisches On-Demand-Laden von Google-Fonts im Editor.
 *
 * Wir injizieren ein <link>-Element pro Family in `document.head`. Mehrfache
 * Aufrufe für dieselbe Familie sind idempotent. Beim Render im Worker
 * geschieht das Laden parallel via einer einzigen kombinierten CSS-URL —
 * siehe `google-fonts-css.ts`.
 */

const ensured = new Set<string>();

export function ensureGoogleFont(family: string): void {
  if (typeof document === "undefined") return;
  const trimmed = family.trim();
  if (!trimmed) return;
  if (ensured.has(trimmed)) return;
  ensured.add(trimmed);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    trimmed,
  )}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&display=swap`;
  document.head.appendChild(link);
}

let manifestPromise: Promise<GoogleFontEntry[]> | null = null;

export interface GoogleFontEntry {
  /** Family name */
  f: string;
  /** Category: serif | sans-serif | display | handwriting | monospace */
  c: string;
  /** Available weights as numeric strings */
  w: string[];
  /** Has italic variant */
  i: boolean;
  /** Popularity rank (1 = most popular) */
  p: number;
}

/**
 * Lädt den vollständigen Manifest aller Google-Fonts (statisch in /public/).
 */
export function loadGoogleFontsManifest(): Promise<GoogleFontEntry[]> {
  if (manifestPromise) return manifestPromise;
  if (typeof window === "undefined") {
    manifestPromise = Promise.resolve([]);
    return manifestPromise;
  }
  manifestPromise = fetch("/google-fonts.json")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return manifestPromise;
}
