import { NextRequest, NextResponse } from "next/server";

// Lucia note: we cannot import the full Lucia adapter in middleware (Edge runtime
// would not support node-postgres). Therefore we keep the middleware lightweight
// and only check for the presence of the session cookie. Fine-grained role checks
// happen in the layout/RSC via requireUser / requireAdmin.
//
// Custom-Domains note: this middleware ALSO runs on every request to the
// app (matcher includes "/" via OWN_HOSTS detection). On Custom-Domain
// requests it rewrites `<host>/<slug>` to the internal Next.js route
// `/v/<slug>?_host=<host>`, where the public-page handler resolves the
// `(slug, domain)` pair in Node-runtime (Edge can't reach the DB).

const SESSION_COOKIE = "videocomet_session";

const ADMIN_PUBLIC_PATHS = ["/admin/login"];

/**
 * Hosts that we serve as the "main app" — anything else is treated as a
 * potential custom-domain. Includes localhost variants so local dev works.
 *
 * `lp.videocomet.de` is the dedicated Custom-LP sandbox subdomain. It is
 * counted as an OWN host (so it bypasses the custom-domain rewrite) but
 * gets its own /<slug> → /cv/<slug> rewrite below.
 */
const OWN_HOSTS = new Set<string>([
  "app.videocomet.de",
  "videocomet.de",
  "www.videocomet.de",
  "lp.videocomet.de",
  "localhost",
  "127.0.0.1",
]);

/**
 * The Custom-LP sandbox subdomain. Requests on this host with a non-app
 * path are rewritten to `/cv/<slug>` so the sandbox renderer handles
 * them. Calling it out separately (instead of overloading
 * `app.videocomet.de`) keeps the security boundary clean: any future
 * cookie/CORS policy applies to the entire host, not to a sub-path.
 */
const SANDBOX_LP_HOST = "lp.videocomet.de";

/**
 * Pfade die NIE durch das Custom-Domain-Rewrite gehen — sonst zerlegen wir
 * /api-Calls, Next-Static, das Tracking-Pixel etc.
 *
 * Hinweis: `/share/` ist der Public-Password-Protected-Campaign-Share
 * (Migration 0022, Route `/share/[token]`). Der Token-Pfad darf weder
 * vom Custom-Domain-Rewrite noch vom App-Session-Guard angefasst werden —
 * Besucher haben keine Lucia-Session, sondern ein eigenes signiertes
 * Cookie (siehe `src/lib/share-cookie.ts`).
 */
function isPassthroughPath(pathname: string): boolean {
  return (
    pathname === "/" ||  // root: zeigen wir kein Lead → eigenes Catch-all
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/api/share/") ||
    // Stealth-Tracking-Endpoint. Wird auf lp.videocomet.de und Custom-
    // Domains direkt zur App durchgereicht — first-party-Tracking ohne
    // CORS-Trigger und ohne AdBlocker-Match auf /api/track/event.
    // (Folder darf NICHT mit `_` beginnen — Next.js behandelt `_*` als
    // private und kompiliert die Route gar nicht.)
    pathname === "/c" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

function isAdminPath(pathname: string) {
  if (!pathname.startsWith("/admin")) return false;
  return !ADMIN_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAppPath(pathname: string) {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/kampagnen") ||
    pathname.startsWith("/runden") ||
    pathname.startsWith("/mediathek") ||
    pathname.startsWith("/einstellungen") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/app/")
  );
}

/**
 * Klassifiziert den Host:
 *   "own"        → app.videocomet.de und Verwandte (unsere App)
 *   "custom"     → potentiell Custom-Domain (DB entscheidet)
 *   "ignore"     → leerer Host o.ae.
 */
function classifyHost(host: string | null | undefined): "own" | "custom" | "ignore" {
  if (!host) return "ignore";
  const lower = host.toLowerCase().split(":")[0]; // strip port
  if (OWN_HOSTS.has(lower)) return "own";
  return "custom";
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  const rawHost = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const hostKind = classifyHost(rawHost);

  // ── Custom-LP-Sandbox-Routing (lp.videocomet.de) ──────────────────────
  // Requests on the dedicated sandbox host map `/[slug]` → `/cv/[slug]`,
  // and `/[slug]/<rest>` → `/cv/[slug]/<rest>` so the asset pass-through
  // route handles deeper paths. This is HOST-based (not path-based)
  // because the customer's uploaded HTML uses root-relative URLs that
  // must keep resolving against `/cv/<slug>/`.
  //
  // We intentionally don't try to be smart about WHETHER the slug
  // belongs to a Custom-LP campaign here — the /cv/ handler does that
  // DB lookup in Node-runtime. In Edge runtime we'd have to import the
  // DB driver which is not viable.
  //
  // v1 limitation: this host is the ONLY way to reach a Custom-LP. A
  // campaign that mixes a Custom-LP template with a Custom-Domain is
  // unsupported until v2 (the customer must point users at
  // lp.videocomet.de).
  if (rawHost === SANDBOX_LP_HOST && !isPassthroughPath(pathname)) {
    // Already on the right internal path? Let it through unchanged.
    if (pathname.startsWith("/cv/")) return NextResponse.next();
    const segments = pathname.replace(/^\/+/, "").split("/");
    const slug = segments[0];
    if (!slug) return NextResponse.next();
    const rest = segments.slice(1).join("/");
    const url = req.nextUrl.clone();
    url.pathname = rest ? `/cv/${slug}/${rest}` : `/cv/${slug}`;
    return NextResponse.rewrite(url);
  }

  // ── Custom-Domain-Routing ────────────────────────────────────────────
  // Requests auf Kunden-Hosts werden auf /v/<slug>?_host=<host> rewritten.
  // /api/*, /_next/* etc. werden unverändert durchgelassen, damit
  // Tracking-Endpoint + statische Assets weiter funktionieren.
  //
  // Custom-LP-Edge-Case: wenn die Kampagne ein Custom-HTML-Template gepinnt
  // hat, leitet /v/[slug]/page.tsx (Node-Runtime, kann DB) intern via 307
  // auf /cv/<slug>?_host=<host> um. Damit DAS nicht erneut zum /v/-Rewrite
  // wird, müssen wir `/cv/`-Pfade hier auch durchlassen.
  if (hostKind === "custom" && !isPassthroughPath(pathname)) {
    if (pathname.startsWith("/v/")) return NextResponse.next();
    if (pathname.startsWith("/cv/")) return NextResponse.next();
    const url = req.nextUrl.clone();
    const slug = pathname.replace(/^\/+/, "").split("/")[0];
    if (!slug) return NextResponse.next();
    url.pathname = `/v/${slug}`;
    url.searchParams.set("_host", req.headers.get("host") ?? "");
    return NextResponse.rewrite(url);
  }

  if (isAdminPath(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isAppPath(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = pathname !== "/login" ? `?next=${encodeURIComponent(pathname + search)}` : "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Matcher umfasst jetzt alle Pfade ausser den klar passthrough-Statics —
  // wir brauchen das, damit Custom-Domain-Requests an `/` auch durch die
  // Middleware laufen. Performance ist okay: Middleware ist nur ein paar
  // Stringvergleiche, kein DB-Hit.
  matcher: [
    /*
     * Match everything except:
     * - _next/static, _next/image, favicon.ico, public files
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
