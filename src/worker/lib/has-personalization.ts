/**
 * Detect ob ein Thumbnail-Template überhaupt Lead-Personalisierung benötigt.
 *
 * Hintergrund — Paket D, Smart-Caching:
 *   Der Thumbnail-Generator soll EINMAL pro Run rendern, wenn dasselbe
 *   Bild für jeden Lead identisch ist; und N×Mal (pro Lead) sobald
 *   IRGENDWO ein Platzhalter steckt. Diese Funktion ist das Routing-
 *   Kriterium für genau diese Verzweigung.
 *
 * Strategie:
 *   Die Layer-Struktur ist heterogen (Text/Image/Shape, mit verschiedenen
 *   Feldnamen je Kind: `contentHtml`, `publicUrl`, `fill`, …) und kann sich
 *   schemaseitig noch ändern. Statt jedes Feld einzeln zu prüfen scannen
 *   wir das komplette JSON-Stringify-Output nach `{{…}}`-Tokens — das ist
 *   robust gegen zukünftige Layer-Typen und Layer-Felder.
 *
 * WICHTIG: System-Keys wie `{{pageUrl}}` zählen als „personalisiert", weil
 * sich pageUrl pro Lead ändert (jeder Lead hat seinen eigenen slug). Wir
 * machen also keine Ausnahme-Liste — sobald irgendein `{{key}}` drinsteht,
 * wird pro Lead gerendert.
 */

import type { CampaignThumbnailImage } from "@/lib/segments/types";

/**
 * `{{ key }}` Token-Regex.
 *  - Whitespace zwischen Klammern und Key ist toleriert (analog substitute()).
 *  - Key-Zeichen sind absichtlich permissiv (`[^}]+`), weil wir nur DETECT
 *    machen — die tatsächliche Substitution wird vom zentralen `substitute()`
 *    gehandhabt.
 */
const PLACEHOLDER_TOKEN_RE = /\{\{\s*[^}\s][^}]*\}\}/;

/**
 * Liefert `true` wenn das Thumbnail-Template mindestens einen `{{key}}`-Token
 * irgendwo in seinem JSON-Tree enthält. Andernfalls `false` → Run kann das
 * gerenderte Bild zwischen allen Leads sharen.
 *
 * Niemals werfend — defensiv gegen kaputte/null Inputs. Im Zweifel
 * (Stringify wirft, was bei einem zirkulären Bunny-Asset-Ref theoretisch
 * passieren könnte) returnen wir `true`, damit wir lieber zu oft rendern
 * als das geteilte Bild personalisierte Daten leaken zu lassen.
 */
export function hasPersonalization(
  content: CampaignThumbnailImage | null | undefined,
): boolean {
  if (!content) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(content);
  } catch {
    // Konservativ: lieber pro-Lead rendern als versehentlich
    // personalisierte Daten in einem geteilten Bild leaken.
    return true;
  }
  return PLACEHOLDER_TOKEN_RE.test(serialized);
}
