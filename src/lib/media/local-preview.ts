/**
 * Lokale Sofort-Vorschau für frisch hochgeladene Medien.
 *
 * Bunny Stream braucht nach dem Upload 15–60 s, bis eine abspielbare MP4
 * verfügbar ist. Damit der Nutzer seine Szene sofort sieht, merken wir uns
 * die Original-Datei als Blob-URL, keyed auf die spätere publicUrl.
 *
 * Modul-Singleton: überlebt SPA-Navigation, geht bei Hard-Reload verloren —
 * dann greift die bestehende Auto-Retry-Logik gegen Bunny.
 */

const previews = new Map<string, string>();

export function registerLocalMediaPreview(key: string, file: Blob): void {
  if (!key) return;
  const previous = previews.get(key);
  if (previous) URL.revokeObjectURL(previous);
  previews.set(key, URL.createObjectURL(file));
}

export function getLocalMediaPreview(key: string): string | null {
  return previews.get(key) ?? null;
}

/** Entfernt eine Vorschau, z. B. wenn die Blob-URL nicht abspielbar ist. */
export function dropLocalMediaPreview(key: string): void {
  const previous = previews.get(key);
  if (previous) {
    URL.revokeObjectURL(previous);
    previews.delete(key);
  }
}
