/**
 * Re-export für die Folien-Refresh-Funktion.
 *
 * Implementation liegt in `import.ts`, weil sie sich mit
 * `importPublishedDeck` 90 % der Puppeteer-Logik teilt. Dieser File
 * existiert nur, damit Aufrufer aus klar getrennten Verantwortlich-
 * keits-Sichten („Folie aktualisieren") nicht versehentlich einen
 * Voll-Import auslösen.
 */

export { refreshSlide } from "./import";
export type { RefreshSlideResult } from "./import";
