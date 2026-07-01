/**
 * Access-Gate — entscheidet ob ein User Zugriff auf die App-Features hat.
 *
 * Business-Regel: Ohne aktive 40€/Monat-Subscription ist die App gesperrt.
 *   - Aktive Subscription (status = 'active' oder 'trialing'): voller Zugriff
 *   - past_due mit noch nicht abgelaufener Periode: Gnadenfrist, voller Zugriff
 *   - Alle anderen Status (canceled, unpaid, incomplete, past_due-expired,
 *     NULL): App gesperrt → Paywall
 *
 * Admin-Bypass: role='admin' ist NIE gesperrt (Support/Testing).
 *
 * Ausnahme-Routen: bestimmte Pfade muessen auch bei gesperrter Subscription
 * erreichbar sein, sonst kommt der User nicht wieder rein:
 *   - /einstellungen (damit er Abrechnungs-Tab sieht)
 *   - /api/billing/* (Checkout, Portal, Status)
 *   - /api/auth/logout
 *   - /api/me (fuer UI-Rendering)
 *   - /api/stripe/webhook (Server-zu-Server, kein User-Cookie)
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type AccessDecision =
  | { access: "allowed"; reason: "admin" | "active" | "grace_period" }
  | {
      access: "blocked";
      reason:
        | "no_subscription"
        | "past_due_expired"
        | "canceled"
        | "unpaid"
        | "incomplete";
      periodEnd: Date | null;
    };

interface AccessInput {
  role: "admin" | "user";
  subscriptionStatus:
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "trialing"
    | "unpaid"
    | null;
  subscriptionCurrentPeriodEnd: Date | null;
}

export function computeAccess(input: AccessInput): AccessDecision {
  if (input.role === "admin") {
    return { access: "allowed", reason: "admin" };
  }

  const status = input.subscriptionStatus;
  if (status === "active" || status === "trialing") {
    return { access: "allowed", reason: "active" };
  }

  if (status === "past_due") {
    // Stripe-Standard: past_due behaelt Zugriff bis current_period_end,
    // dann faellt es auf unpaid oder canceled. Wir respektieren das.
    if (
      input.subscriptionCurrentPeriodEnd &&
      input.subscriptionCurrentPeriodEnd.getTime() > Date.now()
    ) {
      return { access: "allowed", reason: "grace_period" };
    }
    return {
      access: "blocked",
      reason: "past_due_expired",
      periodEnd: input.subscriptionCurrentPeriodEnd,
    };
  }

  if (status === "canceled") {
    // Bei "canceled" mit noch laufender Periode: bis Ende zugelassen.
    if (
      input.subscriptionCurrentPeriodEnd &&
      input.subscriptionCurrentPeriodEnd.getTime() > Date.now()
    ) {
      return { access: "allowed", reason: "grace_period" };
    }
    return {
      access: "blocked",
      reason: "canceled",
      periodEnd: input.subscriptionCurrentPeriodEnd,
    };
  }

  if (status === "unpaid") {
    return {
      access: "blocked",
      reason: "unpaid",
      periodEnd: input.subscriptionCurrentPeriodEnd,
    };
  }

  if (status === "incomplete") {
    return {
      access: "blocked",
      reason: "incomplete",
      periodEnd: null,
    };
  }

  // status === null → nie eine Subscription angelegt
  return { access: "blocked", reason: "no_subscription", periodEnd: null };
}

/**
 * Laedt User + Access-Decision in einem Query. Wird von der Middleware
 * und Server-Components genutzt.
 */
export async function loadAccessDecision(userId: string): Promise<AccessDecision> {
  const [row] = await db
    .select({
      role: users.role,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return { access: "blocked", reason: "no_subscription", periodEnd: null };
  return computeAccess({
    role: row.role,
    subscriptionStatus: row.subscriptionStatus,
    subscriptionCurrentPeriodEnd: row.subscriptionCurrentPeriodEnd,
  });
}

/**
 * Pfade die auch bei gesperrter Subscription erreichbar sein muessen —
 * sonst kommt der User nicht wieder rein.
 */
const ALLOWED_BLOCKED_PATHS = [
  "/einstellungen",           // damit User Abrechnungs-Tab sieht
  "/api/billing",             // Checkout, Portal, Status, History, Invoices
  "/api/me",                  // UI-Rendering
  "/api/auth/logout",         // Ausloggen muss immer gehen
  "/api/stripe/webhook",      // Server-zu-Server
  "/api/health",              // Uptime-Checks
  "/api/render-engine",       // Setup-UI (Admin sowieso, aber offen halten)
];

export function isPathAllowedWhenBlocked(pathname: string): boolean {
  return ALLOWED_BLOCKED_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Human-readable Reason fuer die Paywall-UI.
 */
export function reasonLabel(reason: AccessDecision["reason"]): string {
  switch (reason) {
    case "admin":
    case "active":
    case "grace_period":
      return "Zugang aktiv";
    case "no_subscription":
      return "Kein Zugang — bitte Plan aktivieren";
    case "canceled":
      return "Zugang gekündigt";
    case "past_due_expired":
      return "Zahlung überfällig";
    case "unpaid":
      return "Zahlung fehlgeschlagen";
    case "incomplete":
      return "Zahlungs-Setup unvollständig";
  }
}
