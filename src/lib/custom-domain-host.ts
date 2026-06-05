/**
 * Liefert den Custom-Domain-Host eines Requests.
 *
 * Hintergrund: bei Custom-Domain-Requests setzt die Middleware den
 * `_host`-Query-Param. Unter Next.js 14 Edge-Middleware-Rewrites kommt
 * dieser Param aber NICHT zuverlaessig in jedem Node-Runtime-Handler an
 * (insbesondere bei Asset-Pass-Through-Routen wie /cv/<slug>/<asset>).
 *
 * Als Fallback liest dieser Helper den Request-Host-Header und filtert
 * App-eigene Hosts heraus (127.0.0.1, app.videocomet.de, lp.videocomet.de,
 * *.vercel.app), damit der Lookup bei diesen Hosts wie bisher auf den
 * Default-Namespace (`domain_id IS NULL`) faellt.
 *
 * Wichtig fuer Custom-LP-Assets: ohne diesen Fallback wuerden CSS-/JS-/
 * Bild-Requests an `/cv/<slug>/style.css` auf der Default-Domain landen,
 * dort einen gleichnamigen anderen Tenant-Slug finden und 404 oder —
 * schlimmer — Assets aus einem fremden Custom-LP-Template ausliefern.
 */

import type { NextRequest } from "next/server";

const APP_OWN_HOSTS = new Set([
  "127.0.0.1",
  "0.0.0.0",
  "localhost",
  "app.videocomet.de",
  "lp.videocomet.de",
]);

/**
 * Interner Filter: nimmt einen rohen Host-String (Query-Param-Wert oder
 * `host`-Header) und entscheidet, ob er einen echten Custom-Domain-Host
 * darstellt. App-eigene Hosts → null (Default-Namespace).
 *
 * DRY-Anker fuer beide Public-Funktionen — die Filter-Semantik MUSS hier
 * zentral leben, sonst driftet das Verhalten zwischen Route-Handlern
 * (NextRequest) und RSC-Pages (searchParams + headers()).
 */
function pickHostStringOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase().split(":")[0];
  if (APP_OWN_HOSTS.has(lower)) return null;
  if (lower.endsWith(".vercel.app")) return null;
  return trimmed;
}

export function resolveCustomDomainHost(req: NextRequest): string | null {
  // eslint-disable-next-line no-restricted-syntax -- zentraler Reader, hier erlaubt
  const queryHost = req.nextUrl.searchParams.get("_host");
  const fromQuery = pickHostStringOrNull(queryHost);
  if (fromQuery) return fromQuery;
  return pickHostStringOrNull(req.headers.get("host"));
}

/**
 * Variante fuer RSC-Pages (kein NextRequest verfuegbar). Akzeptiert die
 * resolvete searchParams (Promise-aufgeloest) und die `headers()`-API.
 * Selbe Logik wie resolveCustomDomainHost: erst Query-Param, sonst
 * Header, eigene App-Hosts filtern.
 */
export function resolveCustomDomainHostFromPage(
  searchParams: Record<string, string | string[] | undefined>,
  headers: { get(name: string): string | null },
): string | null {
  // eslint-disable-next-line no-restricted-syntax -- zentraler Reader, hier erlaubt
  const raw = searchParams?.["_host"];
  const queryHostRaw = typeof raw === "string"
    ? raw
    : Array.isArray(raw)
      ? raw.find((v) => typeof v === "string" && v.trim() !== "") ?? null
      : null;
  const fromQuery = pickHostStringOrNull(queryHostRaw);
  if (fromQuery) return fromQuery;
  return pickHostStringOrNull(headers.get("host"));
}
