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
 */
const OWN_HOSTS = new Set<string>([
  "app.videocomet.de",
  "videocomet.de",
  "www.videocomet.de",
  "localhost",
  "127.0.0.1",
]);

/**
 * Pfade die NIE durch das Custom-Domain-Rewrite gehen — sonst zerlegen wir
 * /api-Calls, Next-Static, das Tracking-Pixel etc.
 */
function isPassthroughPath(pathname: string): boolean {
  return (
    pathname === "/" ||  // root: zeigen wir kein Lead → eigenes Catch-all
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
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
  const hostKind = classifyHost(req.headers.get("host"));

  // ── Custom-Domain-Routing ────────────────────────────────────────────
  // Requests auf Kunden-Hosts werden auf /v/<slug>?_host=<host> rewritten.
  // /api/*, /_next/* etc. werden unveraendert durchgelassen, damit
  // Tracking-Endpoint + statische Assets weiter funktionieren.
  if (hostKind === "custom" && !isPassthroughPath(pathname)) {
    // Schon ein /v/-Pfad? Dann lass durch — kann ein direkter Aufruf sein.
    if (pathname.startsWith("/v/")) return NextResponse.next();
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
