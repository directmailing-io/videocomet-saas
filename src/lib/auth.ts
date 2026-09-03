import { Lucia } from "lucia";
import { NodePostgresAdapter } from "@lucia-auth/adapter-postgresql";
import pg from "pg";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { Session, User } from "lucia";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const adapter = new NodePostgresAdapter(pool, {
  user: "users",
  session: "sessions",
});

export const SESSION_COOKIE_USER = "videocomet_session";
export const SESSION_COOKIE_ADMIN = "videocomet_admin_session";

const sessionCookieAttributes = {
  // httpOnly ist Lucia-Default = true (kein JS-Zugriff auf den Cookie).
  // SECURITY: sameSite="lax" statt "strict" — Cross-Site-Return-Flows
  // (Stripe-Checkout, Email-Reset-Links) muessen die Session
  // mitschicken, sonst landet der User auf Login-Screen. "strict"
  // hat exakt diesen Bug verursacht. CSRF-Schutz kommt aus httpOnly +
  // secure + dem API-Gating in src/middleware.ts (Origin-Check auf
  // mutierenden /api-Routen + Host-Gating fuer lp./Custom-Domains).
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // SECURITY (2026-09-02): host-only (nur app.videocomet.de), kein
  // `domain: ".videocomet.de"` mehr — sonst ging die Session auch an
  // lp.videocomet.de (Kunden-HTML). Alte Domain-Cookies raeumt die
  // Middleware auf, wenn sie doppelt auftauchen.
};

const getUserAttributes = (attributes: {
  email: string;
  role: "admin" | "user";
  is_active: boolean;
  first_name: string | null;
  last_name: string | null;
}) => ({
  email: attributes.email,
  role: attributes.role,
  isActive: attributes.is_active,
  firstName: attributes.first_name,
  lastName: attributes.last_name,
});

/**
 * Kunden-Sitzungen. Cookie `videocomet_session`.
 */
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: SESSION_COOKIE_USER,
    expires: false,
    attributes: sessionCookieAttributes,
  },
  getUserAttributes,
});

/**
 * Admin-Sitzungen (seit 2026-09-03) mit EIGENEM Cookie-Namen. Vorher teilten
 * Admin und Kunde denselben Cookie auf demselben Host: wer sich im Admin
 * anmeldete, ueberschrieb damit seine Kunden-Sitzung (und umgekehrt) und
 * flog in der Kunden-App beim naechsten Klick zum Login. Beide Instanzen
 * arbeiten auf derselben `sessions`-Tabelle.
 */
export const luciaAdmin = new Lucia(adapter, {
  sessionCookie: {
    name: SESSION_COOKIE_ADMIN,
    expires: false,
    attributes: sessionCookieAttributes,
  },
  getUserAttributes,
});

export function luciaFor(role: "admin" | "user") {
  return role === "admin" ? luciaAdmin : lucia;
}

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      role: "admin" | "user";
      is_active: boolean;
      first_name: string | null;
      last_name: string | null;
    };
  }
}

/**
 * Alle Werte eines Cookie-Namens aus dem rohen Cookie-Header. Browser
 * koennen denselben Namen mehrfach schicken (altes domainweites + neues
 * host-only Cookie, oder zwei Konten): `cookies().get()` sieht davon nur
 * EINEN — wer den falschen zog, landete auf /login (Daniel, 2026-09-03).
 */
async function cookieValues(name: string): Promise<string[]> {
  const raw = (await headers()).get("cookie") ?? "";
  const out: string[] = [];
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const v = trimmed.slice(name.length + 1);
    if (v && !out.includes(v)) out.push(v);
  }
  // Neuestes zuerst: Browser senden aeltere Cookies zuerst.
  return out.reverse();
}

type Validated = { user: User; session: Session } | { user: null; session: null };

/**
 * Prueft die Sitzung. `prefer` bestimmt, welcher Cookie-Name zuerst
 * probiert wird (Admin-Guards: admin, Kunden-Guards: user); ohne Treffer
 * wird der jeweils andere probiert. Alle gesendeten Werte werden getestet,
 * der erste gueltige gewinnt.
 */
export const validateRequest = cache(
  async (prefer: "user" | "admin" = "user"): Promise<Validated> => {
    const order: Array<"user" | "admin"> = prefer === "admin" ? ["admin", "user"] : ["user", "admin"];
    for (const kind of order) {
      const inst = luciaFor(kind);
      const ids = await cookieValues(inst.sessionCookieName);
      for (const id of ids) {
        const result = await inst.validateSession(id);
        if (!result.session) continue;
        try {
          if (result.session.fresh) {
            const c = inst.createSessionCookie(result.session.id);
            (await cookies()).set(c.name, c.value, c.attributes);
          }
        } catch {
          // cookies().set() wirft waehrend statischem Rendering; ignorieren
        }
        return result;
      }
    }
    // Nichts gueltig: beide Cookies (best effort) leeren.
    try {
      const jar = await cookies();
      for (const kind of order) {
        const inst = luciaFor(kind);
        if ((await cookieValues(inst.sessionCookieName)).length > 0) {
          const blank = inst.createBlankSessionCookie();
          jar.set(blank.name, blank.value, blank.attributes);
        }
      }
    } catch {
      // ignore
    }
    return { user: null, session: null };
  },
);

/**
 * Alle gueltigen Sitzungen aus den gesendeten Cookies (fuer Logout: alles
 * abmelden, was der Browser kennt).
 */
export async function allValidSessions(): Promise<Array<{ inst: Lucia; session: Session }>> {
  const found: Array<{ inst: Lucia; session: Session }> = [];
  for (const kind of ["user", "admin"] as const) {
    const inst = luciaFor(kind);
    for (const id of await cookieValues(inst.sessionCookieName)) {
      const r = await inst.validateSession(id);
      if (r.session) found.push({ inst, session: r.session });
    }
  }
  return found;
}
