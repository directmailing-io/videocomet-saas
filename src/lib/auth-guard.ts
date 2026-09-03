import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Session, User } from "lucia";
import { lucia, luciaAdmin, validateRequest } from "@/lib/auth";

export type AuthedRSC = { user: User; session: Session };

// ── RSC Guards ──────────────────────────────────────────────────────────────

export async function requireUser(): Promise<AuthedRSC> {
  const { user, session } = await validateRequest("user");
  if (!user || !session) {
    redirect("/login");
  }
  if (user.role !== "user") {
    redirect("/login");
  }
  if (!user.isActive) {
    // clear cookie best effort
    try {
      const blank = lucia.createBlankSessionCookie();
      (await cookies()).set(blank.name, blank.value, blank.attributes);
    } catch {
      // ignore
    }
    redirect("/login?reason=deactivated");
  }
  return { user, session };
}

export async function requireAdmin(): Promise<AuthedRSC> {
  const { user, session } = await validateRequest("admin");
  if (!user || !session) {
    redirect("/admin/login");
  }
  if (user.role !== "admin") {
    redirect("/admin/login");
  }
  if (!user.isActive) {
    try {
      const blank = luciaAdmin.createBlankSessionCookie();
      (await cookies()).set(blank.name, blank.value, blank.attributes);
    } catch {
      // ignore
    }
    redirect("/admin/login?reason=deactivated");
  }
  return { user, session };
}

// ── API Guards (return discriminated union, callers narrow) ─────────────────

export type ApiGuardResult =
  | { ok: true; user: User; session: Session }
  | { ok: false; response: NextResponse };

export async function requireUserApi(): Promise<ApiGuardResult> {
  const { user, session } = await validateRequest("user");
  if (!user || !session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }),
    };
  }
  if (user.role !== "user") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 }),
    };
  }
  if (!user.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Konto ist deaktiviert." }, { status: 403 }),
    };
  }
  return { ok: true, user, session };
}

export async function requireAdminApi(): Promise<ApiGuardResult> {
  const { user, session } = await validateRequest("admin");
  if (!user || !session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }),
    };
  }
  if (user.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 }),
    };
  }
  if (!user.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Konto ist deaktiviert." }, { status: 403 }),
    };
  }
  return { ok: true, user, session };
}

// Accepts any authenticated, active user (admin OR user). Used for endpoints
// like password-change that any signed-in account may invoke.
export async function requireAnyUserApi(): Promise<ApiGuardResult> {
  const { user, session } = await validateRequest();
  if (!user || !session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }),
    };
  }
  if (!user.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Konto ist deaktiviert." }, { status: 403 }),
    };
  }
  return { ok: true, user, session };
}
