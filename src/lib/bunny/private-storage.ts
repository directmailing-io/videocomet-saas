/**
 * Zugriffsschutz für personenbezogene Dateien in der Bunny-Storage-Zone
 * (Security-Härtung 2026-09-02).
 *
 * Hintergrund: Die Storage-CDN-Zone (videocomet-pdf.b-cdn.net) lieferte
 * alles ohne Authentifizierung aus, auch Webcam-Aufnahmen der Kunden. Ein
 * externer Test hat das bestätigt. Vorschaubilder, E-Mail-GIFs und Brief-
 * PDFs MÜSSEN öffentlich bleiben (Empfänger ohne Login), deshalb wird der
 * Token-Schutz nicht zonenweit, sondern per Bunny-Edge-Rule NUR für diese
 * Pfade aktiviert:
 *
 *   users/<userId>/webcam/*   Webcam-Aufnahmen (Mediathek, Studio)
 *   webcams/*                 Gast-Aufnahmen über Webcam-Share-Links
 *   intro/*                   Stimm-Samples, Raumtöne, KI-Intro-Vorschauen
 *
 * Die Edge-Rule nimmt die Server-IPs (App, Worker, Render-Server) aus:
 * Worker/ffmpeg laden weiter mit den unveränderten URLs aus der DB. Nur
 * Browser brauchen einen Token — den erzeugt `presentStorageUrl()` dort, wo
 * die App URLs an den Client gibt (API-JSON, RSC-<video src>). In der DB
 * bleiben immer die unsignierten URLs (Content-Hashes, Refs, Purge).
 *
 * Token-Format (Bunny "Token Authentication", identisch zu Stream):
 *   token = base64url( sha256( key + path + expires ) ), ?token=…&expires=…
 * Key = ZoneSecurityKey der Pull-Zone, Env BUNNY_STORAGE_TOKEN_AUTH_KEY.
 */

import { createHash } from "node:crypto";

export const PRIVATE_STORAGE_PATH_PATTERNS: RegExp[] = [
  /^\/users\/[^/]+\/webcam\//,
  /^\/webcams\//,
  /^\/intro\//,
];

export const DEFAULT_PRIVATE_URL_TTL_SEC = 60 * 60; // 1 h, Browser holt bei Bedarf neu

let warnedMissingKey = false;

function storageHostname(): string | null {
  const h = process.env.BUNNY_STORAGE_CDN_HOSTNAME;
  return h && h.length > 0 ? h.toLowerCase() : null;
}

function tokenKey(): string | null {
  const k = process.env.BUNNY_STORAGE_TOKEN_AUTH_KEY;
  return k && k.length > 0 ? k : null;
}

/** True, wenn die URL auf der Storage-Zone liegt UND in einem geschützten Ordner. */
export function isPrivateStorageUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  const host = storageHostname();
  if (!host) return false;
  try {
    const u = new URL(rawUrl);
    if (u.hostname.toLowerCase() !== host) return false;
    return PRIVATE_STORAGE_PATH_PATTERNS.some((re) => re.test(u.pathname));
  } catch {
    return false;
  }
}

/**
 * Signiert eine private Storage-URL für den Browser. Öffentliche URLs,
 * fremde Hosts und ungültige Werte kommen unverändert zurück. Bereits
 * vorhandene token/expires-Parameter werden ersetzt (nie doppelt signieren).
 */
export function presentStorageUrl(
  rawUrl: string,
  ttlSec: number = DEFAULT_PRIVATE_URL_TTL_SEC,
): string {
  if (!isPrivateStorageUrl(rawUrl)) return rawUrl;
  const key = tokenKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[bunny:security] BUNNY_STORAGE_TOKEN_AUTH_KEY fehlt — private Storage-URLs werden UNSIGNIERT ausgeliefert.",
      );
    }
    return rawUrl;
  }
  const u = new URL(rawUrl);
  u.searchParams.delete("token");
  u.searchParams.delete("expires");
  const expires = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(ttlSec));
  const sig = createHash("sha256")
    .update(key + u.pathname + String(expires))
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  u.searchParams.set("token", sig);
  u.searchParams.set("expires", String(expires));
  return u.toString();
}

/** Bequemlichkeit für nullable Felder (DB-Spalten). */
export function presentStorageUrlOrNull<T extends string | null | undefined>(rawUrl: T): T {
  if (typeof rawUrl !== "string") return rawUrl;
  return presentStorageUrl(rawUrl) as T;
}

/** Signiert `publicUrl` eines Mediathek-Eintrags (Rest unverändert). */
export function presentMediaItem<T extends { publicUrl: string }>(item: T): T {
  const signed = presentStorageUrl(item.publicUrl);
  return signed === item.publicUrl ? item : { ...item, publicUrl: signed };
}
