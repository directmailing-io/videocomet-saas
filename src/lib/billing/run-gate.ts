/**
 * Run-Gate — Prueft ob ein User einen Run starten darf.
 *
 * Kriterien:
 *   1. Aktive Subscription (`active` oder `past_due` mit Gnadenfrist).
 *   2. Ausreichend Credits fuer die geplante Lead-Anzahl.
 *
 * Wirft strukturierte Fehler mit `kind` — der Caller (API-Route) mappt
 * darauf 402-Responses mit Frontend-erkennbaren `errorKind`.
 *
 * Admin-User werden GAR NICHT gegated — sie duerfen internes Testing +
 * Kunden-Support-Runs machen ohne Billing-Reibung. Das ist intentional
 * und dokumentiert.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { estimateRunCost } from "./credit-service";

export class BillingGateError extends Error {
  constructor(
    public readonly kind: "no_subscription" | "insufficient_credits",
    message: string,
    public readonly details?: { required: number; available: number; shortfall: number },
  ) {
    super(message);
    this.name = "BillingGateError";
  }
}

/**
 * Wirft `BillingGateError` bei Verstoss. Return void bei OK.
 */
export async function assertBillingReadyForRun(input: {
  userId: string;
  plannedLeadCount: number;
  /**
   * Credits pro Video. Default 1. Kampagnen mit personalisierter Video-
   * Begrüßung (intro_enabled) reservieren konservativ 2 Credits pro Lead —
   * beim tatsächlichen Charge kosten Fallback-Leads (kein brauchbarer
   * Vorname / Engine-Fehler) trotzdem nur 1.
   */
  pricePerVideo?: number;
}): Promise<void> {
  const [row] = await db
    .select({
      role: users.role,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!row) throw new Error("user not found");

  // Admin-Bypass: Support/Testing-Runs sollen ungegated durchgehen.
  if (row.role === "admin") return;

  // Subscription-Check.
  const status = row.subscriptionStatus;
  const isActiveNow =
    status === "active" ||
    status === "trialing" ||
    // past_due mit noch nicht abgelaufener Periode = Gnadenfrist
    (status === "past_due" &&
      row.subscriptionCurrentPeriodEnd &&
      row.subscriptionCurrentPeriodEnd.getTime() > Date.now());

  if (!isActiveNow) {
    throw new BillingGateError(
      "no_subscription",
      "Keine aktive Subscription. Bitte Plattform-Zugang aktivieren um Runden zu starten.",
    );
  }

  // Credit-Check.
  const est = await estimateRunCost({
    userId: input.userId,
    leadCount: input.plannedLeadCount,
    pricePerVideo: input.pricePerVideo,
  });
  if (!est.sufficient) {
    throw new BillingGateError(
      "insufficient_credits",
      `Nicht genug Credits: benoetigt ${est.cost}, verfuegbar ${est.available}.`,
      { required: est.cost, available: est.available, shortfall: est.shortfall },
    );
  }
}
