/**
 * Client-safe display helpers fuer URL-Mediathek. KEINE node-API-Imports,
 * deshalb in eigene Datei statt in normalize.ts (die node:crypto braucht).
 */

/** Schoenheitsfunktion fuer Card-Anzeige: lange URLs in der Mitte kuerzen. */
export function truncateUrlMiddle(url: string, max = 60): string {
  if (url.length <= max) return url;
  const head = Math.floor((max - 3) / 2);
  const tail = max - 3 - head;
  return `${url.slice(0, head)}...${url.slice(-tail)}`;
}
