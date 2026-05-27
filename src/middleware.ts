import { NextRequest, NextResponse } from "next/server";

// Lucia note: we cannot import the full Lucia adapter in middleware (Edge runtime
// would not support node-postgres). Therefore we keep the middleware lightweight
// and only check for the presence of the session cookie. Fine-grained role checks
// happen in the layout/RSC via requireUser / requireAdmin.

const SESSION_COOKIE = "videocomet_session";

const ADMIN_PUBLIC_PATHS = ["/admin/login"];

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
    pathname.startsWith("/app/")
  );
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = req.cookies.get(SESSION_COOKIE)?.value;

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
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    "/kampagnen/:path*",
    "/runden/:path*",
    "/mediathek/:path*",
    "/einstellungen/:path*",
    "/app/:path*",
  ],
};
