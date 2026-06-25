/**
 * Public-Endpoint (no app auth): Passwort-Login für einen Public-Share-Link.
 *
 * Flow:
 *   1. Resolve `campaign_shares` per Token. 404 → generischer Fehlertext
 *      (kein Auseinanderhalten "Token unbekannt" vs "Passwort falsch").
 *   2. Rate-Limit: ≥10 fehlgeschlagene Versuche pro (token, ipHash) in den
 *      letzten 15 Minuten → 429.
 *   3. Argon2-Verify das Passwort gegen `passwordHash` (siehe queries/users).
 *   4. Erfolg: signiertes HttpOnly-Cookie setzen + `last_accessed_at`
 *      aktualisieren. Cookie-Pfad ist `/share/<token>`, Max-Age 24 h.
 *
 * Constant-Time-Verteidigung: bei Misserfolg fügen wir 200 ms künstlichen
 * Delay ein, damit die Antwortzeit nicht über "Hash existiert" vs.
 * "Token unbekannt" leakt. Argon2 selbst läuft typischerweise 50–80 ms.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyPassword } from "@/lib/db/queries/users";
import {
  getActiveShareByToken,
  getRecentFailedAttemptCount,
  recordAttempt,
  updateShareLastAccessed,
} from "@/lib/db/queries/campaign-shares";
import {
  requireShareCookieSecret,
  signShareCookie,
} from "@/lib/share-cookie";
import { getClientIp } from "@/lib/tracking";

// Validiert das Secret beim Modul-Load (cold start). Wirft, wenn unset,
// damit Deploys die Konfiguration sofort sichtbar fehlschlagen, statt
// erst beim ersten Public-Request.
requireShareCookieSecret();

const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_FAILS = 10;
const FAILURE_DELAY_MS = 200;
const COOKIE_TTL_SEC = 24 * 60 * 60;

const bodySchema = z.object({
  // Server-Trim ist Defense-in-Depth: der Client trimmt auch (siehe
  // password-prompt.tsx), aber wenn jemand das API direkt aufruft
  // (z.B. Tests, fremdgesteuerte Buttons) wollen wir den selben Vergleich
  // wie bei der Erstellung. Sonst: Hash wurde aus "abcd" erzeugt, User
  // tippt " abcd " → Vergleich schlaegt fehl. Genau dieser Fall war der
  // berichtete Production-Bug.
  password: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Passwort fehlt.").max(256)),
});

function hashIpForAttempt(ip: string): string {
  // Privacy: nur die ersten 16 Hex-Chars (= 64 bit) — reicht für Rate-Limit,
  // verhindert aber, dass aus dem Audit-Log auf die IP zurückgerechnet
  // werden kann. Salting hier ist nicht nötig: wir vergleichen nie quer
  // gegen externe Hash-Tabellen.
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Ungültiger Link." }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const ipHash = hashIpForAttempt(getClientIp(req));

  // Pre-Check Rate-Limit, bevor wir überhaupt Argon2 laufen lassen.
  const recentFails = await getRecentFailedAttemptCount(
    token,
    ipHash,
    RATE_LIMIT_WINDOW_MINUTES,
  );
  if (recentFails >= RATE_LIMIT_MAX_FAILS) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json(
      {
        error: "Zu viele Versuche. Bitte versuche es in 15 Minuten erneut.",
      },
      { status: 429 },
    );
  }

  const share = await getActiveShareByToken(token);
  if (!share) {
    // Wir loggen den Versuch NICHT als ok=false in die Attempt-Tabelle,
    // weil sonst ein simpler "Token raten"-Bot den Rate-Limit-Counter für
    // legitime Owner desselben IPs vollläuft. Stattdessen generischer 404.
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json(
      { error: "Link nicht gefunden." },
      { status: 404 },
    );
  }

  const ok = await verifyPassword(share.passwordHash, body.password);

  // Audit-Log unabhängig vom Ergebnis (für Rate-Limit + spätere Owner-View).
  try {
    await recordAttempt(token, ipHash, ok);
  } catch {
    // Ein Log-Fehler darf den Login nicht blockieren.
  }

  if (!ok) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json(
      { error: "Passwort ist falsch." },
      { status: 401 },
    );
  }

  // Erfolg: Last-Access stempeln (fire-and-forget — kein Fail wenn DB
  // kurz hängt; Cookie wird trotzdem gesetzt).
  try {
    await updateShareLastAccessed(share.id);
  } catch {
    // ignore
  }

  const signed = signShareCookie(token, COOKIE_TTL_SEC);
  (await cookies()).set(signed.name, signed.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: signed.maxAge,
    path: signed.path,
  });

  return NextResponse.json({ ok: true }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
