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

export function resolveCustomDomainHost(req: NextRequest): string | null {
  const queryHost = req.nextUrl.searchParams.get("_host");
  if (queryHost && queryHost.trim() !== "") return queryHost;
  const rawHost = req.headers.get("host");
  if (!rawHost) return null;
  const lower = rawHost.toLowerCase().split(":")[0];
  if (APP_OWN_HOSTS.has(lower)) return null;
  if (lower.endsWith(".vercel.app")) return null;
  return rawHost;
}
