import { Lucia } from "lucia";
import { NodePostgresAdapter } from "@lucia-auth/adapter-postgresql";
import pg from "pg";
import { cookies } from "next/headers";
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

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: "videocomet_session",
    expires: false,
    attributes: {
      // httpOnly ist Lucia-Default = true (kein JS-Zugriff auf den Cookie).
      // SECURITY: sameSite="lax" statt "strict" — Cross-Site-Return-Flows
      // (Stripe-Checkout, Email-Reset-Links) muessen die Session
      // mitschicken, sonst landet der User auf Login-Screen. "strict"
      // hat exakt diesen Bug verursacht. CSRF-Schutz kommt weiterhin
      // aus httpOnly + secure + Origin-Check auf state-changing routes.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  },
  getUserAttributes: (attributes) => ({
    email: attributes.email,
    role: attributes.role,
    isActive: attributes.is_active,
    firstName: attributes.first_name,
    lastName: attributes.last_name,
  }),
});

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

export const validateRequest = cache(
  async (): Promise<{ user: User; session: Session } | { user: null; session: null }> => {
    const sessionId = (await cookies()).get(lucia.sessionCookieName)?.value ?? null;
    if (!sessionId) return { user: null, session: null };

    const result = await lucia.validateSession(sessionId);
    try {
      if (result.session && result.session.fresh) {
        const sessionCookie = lucia.createSessionCookie(result.session.id);
        (await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
      }
      if (!result.session) {
        const sessionCookie = lucia.createBlankSessionCookie();
        (await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
      }
    } catch {
      // cookies().set() throws when called during static rendering; ignore
    }
    return result;
  },
);
