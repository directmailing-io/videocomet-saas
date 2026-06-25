/**
 * URL-Normalisierung + Hash fuer Duplicate-Detection.
 *
 * Wir wollen, dass `https://docs.google.com/document/d/X/edit?usp=sharing`
 * und `https://docs.google.com/document/d/X/edit` als identisch erkannt
 * werden — der User soll dieselbe Google-URL nicht zweimal anlegen koennen.
 *
 * Strategie:
 *   1. URL parsen (wirft bei invalid).
 *   2. Host → lowercase.
 *   3. Trailing slash entfernen.
 *   4. Hash + Search-Params strippen (sind fuer Identitaet irrelevant).
 *   5. sha256.
 */

import { createHash } from "node:crypto";

export function normalizeUrl(rawUrl: string): { canonical: string; hash: string } {
  const u = new URL(rawUrl.trim());
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase();
  let canonical = u.toString();
  // Trailing slash auf Pfad-Ende abschneiden (`/edit/` → `/edit`).
  canonical = canonical.replace(/\/+$/, "");
  const hash = createHash("sha256").update(canonical).digest("hex");
  return { canonical, hash };
}
