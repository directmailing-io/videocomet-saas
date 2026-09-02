/**
 * Re-Authentifizierung für heikle Admin-Aktionen (Security-Härtung 2026-09-02).
 *
 * Passwort setzen, Credits buchen, Gratis-Zugang, Nutzer löschen, Admin
 * anlegen, 2FA ändern: Diese Aktionen verlangen zusätzlich das aktuelle
 * Passwort des Admins im Request-Body (`adminPassword`). Damit reicht eine
 * entwendete Admin-Session (offener Laptop, XSS, Cookie-Diebstahl) allein
 * nicht mehr aus, um Konten zu übernehmen oder Geld zu bewegen.
 *
 * Fehlversuche sind pro Admin auf 5 je 15 Minuten begrenzt.
 */

import { NextResponse } from "next/server";
import { getUserById, verifyPassword } from "@/lib/db/queries/users";
import { checkRateLimit } from "@/lib/rate-limit";

export type ReauthResult = { ok: true } | { ok: false; response: NextResponse };

export async function requireAdminPassword(
  adminId: string,
  adminPassword: unknown,
): Promise<ReauthResult> {
  if (typeof adminPassword !== "string" || adminPassword.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Bitte zur Bestätigung dein Admin-Passwort eingeben.", reauthRequired: true },
        { status: 403 },
      ),
    };
  }
  const rl = await checkRateLimit(`admin-reauth:${adminId}`, 5, 15 * 60);
  if (!rl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Zu viele falsche Passwörter. Bitte 15 Minuten warten." },
        { status: 429 },
      ),
    };
  }
  let admin;
  try {
    admin = await getUserById(adminId);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }),
    };
  }
  const valid = await verifyPassword(admin.passwordHash, adminPassword);
  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin-Passwort ist falsch.", reauthRequired: true },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

/** Liest `adminPassword` aus einem bereits geparsten JSON-Body (oder null). */
export function pickAdminPassword(body: unknown): string | null {
  if (body && typeof body === "object" && "adminPassword" in body) {
    const v = (body as { adminPassword?: unknown }).adminPassword;
    return typeof v === "string" ? v : null;
  }
  return null;
}
