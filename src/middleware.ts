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
 * Host-Split: die Marketing-Homepage lebt auf videocomet.de (+ www),
 * der Memberbereich auf app.videocomet.de. Die Middleware sorgt dafuer,
 * dass ein Request auf dem falschen Host auf die richtige Domain
 * umgeleitet wird — sonst waeren /login, /agb etc. auf beiden Domains
 * verfuegbar (Duplicate-Content + Cookie-Chaos).
 *
 * Localhost ist bewusst nicht dabei — im Dev laeuft alles auf einem Host.
 */
const APP_HOST = "app.videocomet.de";
const MARKETING_HOSTS = new Set<string>([
  "videocomet.de",
  "www.videocomet.de",
]);
/**
 * Pfade die auf videocomet.de gerendert werden (Marketing-Domain).
 * `/signup` läuft bewusst auch hier — der User will den Kauf-Flow auf der
 * Marketing-Domain, nicht auf dem Memberbereich.
 *
 * `/signup/success` ist die Stripe-Success-Page; nach Zahlung landet der
 * User erst auf videocomet.de/signup/success, klickt sich dann per Link
 * in den Memberbereich rüber. Die Session-Cookie ist auf `.videocomet.de`
 * gescopet (siehe src/lib/auth.ts), damit der Login domain-übergreifend gilt.
 */
const MARKETING_ONLY_PATHS = new Set<string>([
  "/",
  "/agb",
  "/impressum",
  "/datenschutz",
]);
function isMarketingOnlyPath(pathname: string): boolean {
  if (MARKETING_ONLY_PATHS.has(pathname)) return true;
  if (pathname === "/signup" || pathname.startsWith("/signup/")) return true;
  return false;
}

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
    pathname === "/" ||  // root: auf Custom-Domains eigener Rewrite → /domain-root (siehe unten)
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/api/share/") ||
    // KRITISCH (CROSS-TENANT-LEAK-FIX): Interne Block-LP-Route. Wird
    // vom /v/[slug]-Dispatcher via Loopback-Fetch
    // (http://127.0.0.1:3000/lp-block/<slug>?_host=...) aufgerufen.
    // Wenn das Middleware-Rewrite das hier erneut greift, mapped es
    // /lp-block/<slug> auf /v/lp-block (first segment "lp-block" wird
    // als slug interpretiert) und das _host-Query-Param geht beim
    // Re-Rewrite verloren. Folge: lp-block-Page faellt auf
    // getLeadBySlugForDefaultDomain zurueck und liefert einen
    // gleichnamigen Slug aus EINER FREMDEN Kampagne aus
    // (Cross-Campaign-Leak, Beispiel: video.kunde-a.de/felix zeigt
    // den Lead "felix" aus der Default-Domain Kampagne von kunde-b).
    // Muss UNBEDINGT passthrough bleiben.
    pathname.startsWith("/lp-block/") ||
    // Stealth-Tracking-Endpoint. Wird auf lp.videocomet.de und Custom-
    // Domains direkt zur App durchgereicht — first-party-Tracking ohne
    // CORS-Trigger und ohne AdBlocker-Match auf /api/track/event.
    // (Folder darf NICHT mit `_` beginnen — Next.js behandelt `_*` als
    // private und kompiliert die Route gar nicht.)
    pathname === "/c" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/opengraph-image")
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

  // ── Host-Split: videocomet.de = Marketing, app.videocomet.de = App ───
  // Enforced nur fuer die Produktions-Hosts. Localhost/127.0.0.1 laufen
  // durch den bestehenden Codepfad (App-Content auf einem Host).
  if (rawHost === "www.videocomet.de") {
    // Kanonisierung: www → non-www (SEO + Cookie-Konsistenz).
    return NextResponse.redirect(
      new URL(`https://videocomet.de${pathname}${search}`),
      301,
    );
  }
  if (MARKETING_HOSTS.has(rawHost)) {
    // Auf der Marketing-Domain sind nur die Marketing-Pfade und die
    // technisch-neutralen Passthrough-Endpunkte (/api/health etc.)
    // erlaubt. Alles andere → 302 zur App-Domain.
    if (!isMarketingOnlyPath(pathname) && !isPassthroughPath(pathname)) {
      return NextResponse.redirect(
        new URL(`https://app.videocomet.de${pathname}${search}`),
        302,
      );
    }
    // Marketing rendern: direkt durchlassen, ohne die spaeteren
    // isAppPath/isAdminPath-Checks (die kennen die Marketing-Semantik nicht).
    const marketingHeaders = new Headers(req.headers);
    marketingHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: marketingHeaders } });
  }
  if (rawHost === APP_HOST) {
    // Marketing-Pfade auf App-Host → auf Marketing-Host umleiten
    // (Kanonisierung). Root bleibt hier ausgeklammert und wird direkt
    // in der App-Root-Handling behandelt (Login/Dashboard-Redirect).
    if (isMarketingOnlyPath(pathname) && pathname !== "/") {
      return NextResponse.redirect(
        new URL(`https://videocomet.de${pathname}`),
        302,
      );
    }
    if (pathname === "/") {
      // Root im Memberbereich: eingeloggt → Dashboard, sonst → Login.
      const url = req.nextUrl.clone();
      url.pathname = session ? "/kampagnen" : "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
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
  // Root auf Custom-Domains: NIE die VIDEOCOMET-Marketing-Page zeigen
  // (white-label!). Der Node-Handler /domain-root entscheidet per DB:
  // 302 auf die vom User konfigurierte URL oder neutrale 404-Seite.
  if (hostKind === "custom" && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/domain-root";
    url.search = "";
    url.searchParams.set("_host", rawHost);
    return NextResponse.rewrite(url);
  }

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
    // Pathname als Request-Header propagieren — Server-Components
    // (Layout, Access-Gate) koennen das per `headers()` lesen. Wir setzen
    // ihn auf REQUEST-Level via `next({ request: { headers } })`, sonst
    // sieht `headers()` in RSC den Wert nicht.
    const passHeaders = new Headers(req.headers);
    passHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: passHeaders } });
  }

  const finalHeaders = new Headers(req.headers);
  finalHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: finalHeaders } });
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
