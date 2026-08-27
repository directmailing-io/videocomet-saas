/**
 * Credit-Service — Single-Source-of-Truth fuer alle Credit-Bewegungen.
 *
 * Alle Mutationen MUESSEN durch diese Lib gehen — niemals direkter
 * UPDATE/INSERT auf `users.creditBalance` oder `credit_transactions`.
 * Das garantiert:
 *   - Append-Only-Ledger bleibt konsistent
 *   - Cache-Balance bleibt synchron mit SUM(delta)
 *   - Idempotenz-Constraints werden respektiert
 *   - Race-Conditions sind durch SELECT FOR UPDATE ausgeschlossen
 */

import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creditTransactions,
  users,
  type CreditTransaction,
} from "@/lib/db/schema";

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Nicht genug Credits: benoetigt ${required}, verfuegbar ${available}.`);
    this.name = "InsufficientCreditsError";
  }
}

export class DuplicateChargeError extends Error {
  constructor(public readonly leadId: string) {
    super(`Lead ${leadId} wurde bereits gechargt.`);
    this.name = "DuplicateChargeError";
  }
}

/**
 * Drizzle wirft bei Query-Fehlern einen Wrapper — der Postgres-Fehlercode
 * (z.B. 23505) steckt dann in `err.cause`, nicht auf dem Error selbst.
 * Ohne den cause-Check wurden Duplicate-Charges bei Regenerierungen als
 * „charge failed — needs admin review" gemeldet statt still dedupliziert.
 */
function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: string })?.code;
  if (direct) return direct;
  return ((err as { cause?: { code?: string } })?.cause)?.code;
}

export interface BalanceInfo {
  /** Cached balance aus users.creditBalance — schneller Read. */
  balance: number;
}

export async function getBalance(userId: string): Promise<BalanceInfo> {
  const [row] = await db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { balance: row?.balance ?? 0 };
}

/**
 * Zieht einen Credit-Charge fuer einen erfolgreichen Video-Render ab.
 *
 * Race-Safety: Wir locken die users-Row mit FOR UPDATE bevor wir Balance
 * lesen und schreiben. Parallel-Worker, die denselben User chargen
 * wollen, warten serialisiert.
 *
 * Idempotenz: UNIQUE-Constraint auf (lead_id) WHERE kind='video_charge'.
 * Wenn der Worker mal retry'd und die videoAlreadyDone-Logik mal nicht
 * greift, schlaegt der INSERT mit UNIQUE-Violation fehl → wir fangen das
 * und werfen DuplicateChargeError (Caller ignoriert das).
 *
 * Failure-Modes:
 *   - Insufficient: InsufficientCreditsError mit required/available.
 *     Caller (Worker oder Pre-Run-Gate) reagiert je nach Kontext.
 *   - Duplicate: DuplicateChargeError. Caller swallowed — Lead war schon
 *     gechargt, nichts zu tun.
 */
export async function chargeForVideo(input: {
  userId: string;
  leadId: string;
  runId: string;
  amount?: number;
}): Promise<CreditTransaction> {
  const amount = input.amount ?? 1;
  if (amount < 1) {
    throw new Error("chargeForVideo amount must be >= 1");
  }

  return await db.transaction(async (tx) => {
    // 1) Lock User-Row + lese aktuelle Balance.
    const [row] = await tx.execute<{ credit_balance: number }>(
      sql`SELECT credit_balance FROM users WHERE id = ${input.userId} FOR UPDATE`,
    );
    const currentBalance = (row as { credit_balance: number } | undefined)?.credit_balance ?? 0;

    // 2) Sufficient?
    if (currentBalance < amount) {
      throw new InsufficientCreditsError(amount, currentBalance);
    }

    const newBalance = currentBalance - amount;

    // 3) INSERT credit_tx — fails mit UNIQUE-Violation falls Lead schon
    //    gechargt wurde (idempotent gegen Doppel-Charge).
    try {
      const [txRow] = await tx
        .insert(creditTransactions)
        .values({
          userId: input.userId,
          kind: "video_charge",
          delta: -amount,
          balanceAfter: newBalance,
          leadId: input.leadId,
          runId: input.runId,
        })
        .returning();

      // 4) Update cached balance auf users-Row (atomar in derselben Tx).
      await tx
        .update(users)
        .set({ creditBalance: newBalance, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

      return txRow!;
    } catch (err) {
      // Postgres unique-violation = code 23505
      if (pgErrorCode(err) === "23505") {
        throw new DuplicateChargeError(input.leadId);
      }
      throw err;
    }
  });
}

/**
 * Schreibt einen Top-Up gut (Stripe-Webhook nach erfolgreichem Payment).
 *
 * Idempotenz: stripeEventId UNIQUE — Webhook-Replay (Stripe sendet bei
 * Timeouts denselben Event mehrfach) wird hier dedup'd.
 */
export async function grantTopup(input: {
  userId: string;
  amount: number;
  stripeEventId: string;
  stripeRef?: string | null;
}): Promise<CreditTransaction | null> {
  if (input.amount < 1) {
    throw new Error("grantTopup amount must be >= 1");
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ credit_balance: number }>(
      sql`SELECT credit_balance FROM users WHERE id = ${input.userId} FOR UPDATE`,
    );
    const currentBalance = (row as { credit_balance: number } | undefined)?.credit_balance ?? 0;
    const newBalance = currentBalance + input.amount;

    try {
      const [txRow] = await tx
        .insert(creditTransactions)
        .values({
          userId: input.userId,
          kind: "topup",
          delta: input.amount,
          balanceAfter: newBalance,
          stripeEventId: input.stripeEventId,
          stripeRef: input.stripeRef ?? null,
        })
        .returning();

      await tx
        .update(users)
        .set({ creditBalance: newBalance, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

      return txRow!;
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        // Duplicate-Event: Webhook-Replay — already-processed, return null
        // damit Caller (Webhook-Handler) das als "ok already done" werten kann.
        return null;
      }
      throw err;
    }
  });
}

export const WELCOME_CREDITS_REASON = "startquartal-startguthaben";

/**
 * Startguthaben beim ersten Abo-Abschluss (Startquartal: 20 Credits).
 *
 * Idempotenz: genau EINMAL pro User, unabhaengig davon wie oft der
 * Webhook replay't oder ob der User spaeter kuendigt und neu abschliesst.
 * Guard: Existenz-Check auf promo_grant mit WELCOME_CREDITS_REASON
 * innerhalb der Transaktion (User-Row ist via FOR UPDATE gelockt, damit
 * koennen zwei parallele Webhooks nicht beide durchkommen).
 */
export async function grantWelcomeCredits(input: {
  userId: string;
  amount: number;
  stripeRef?: string | null;
}): Promise<CreditTransaction | null> {
  if (input.amount < 1) {
    throw new Error("grantWelcomeCredits amount must be >= 1");
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ credit_balance: number }>(
      sql`SELECT credit_balance FROM users WHERE id = ${input.userId} FOR UPDATE`,
    );
    const currentBalance = (row as { credit_balance: number } | undefined)?.credit_balance ?? 0;

    const [existing] = await tx
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        sql`${creditTransactions.userId} = ${input.userId}
          AND ${creditTransactions.kind} = 'promo_grant'
          AND ${creditTransactions.reason} = ${WELCOME_CREDITS_REASON}`,
      )
      .limit(1);
    if (existing) return null;

    const newBalance = currentBalance + input.amount;
    const [txRow] = await tx
      .insert(creditTransactions)
      .values({
        userId: input.userId,
        kind: "promo_grant",
        delta: input.amount,
        balanceAfter: newBalance,
        stripeRef: input.stripeRef ?? null,
        reason: WELCOME_CREDITS_REASON,
      })
      .returning();

    await tx
      .update(users)
      .set({ creditBalance: newBalance, updatedAt: new Date() })
      .where(eq(users.id, input.userId));

    return txRow!;
  });
}

/**
 * Manuelle Admin-Korrektur (Refund, Goodwill, etc.). Kann positiv ODER
 * negativ sein. KEIN Idempotenz-Guard hier — Admin trackt das selbst.
 */
export async function adminAdjust(input: {
  userId: string;
  adminUserId: string;
  delta: number;
  reason: string;
}): Promise<CreditTransaction> {
  if (input.delta === 0) {
    throw new Error("adminAdjust delta must be != 0");
  }
  if (!input.reason || input.reason.trim().length < 3) {
    throw new Error("adminAdjust reason is required (min 3 chars)");
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ credit_balance: number }>(
      sql`SELECT credit_balance FROM users WHERE id = ${input.userId} FOR UPDATE`,
    );
    const currentBalance = (row as { credit_balance: number } | undefined)?.credit_balance ?? 0;
    const newBalance = currentBalance + input.delta;

    if (newBalance < 0) {
      throw new Error(
        `Resulting balance would be negative: ${currentBalance} + ${input.delta} = ${newBalance}`,
      );
    }

    const [txRow] = await tx
      .insert(creditTransactions)
      .values({
        userId: input.userId,
        kind: "admin_adjust",
        delta: input.delta,
        balanceAfter: newBalance,
        adminUserId: input.adminUserId,
        reason: input.reason.trim(),
      })
      .returning();

    await tx
      .update(users)
      .set({ creditBalance: newBalance, updatedAt: new Date() })
      .where(eq(users.id, input.userId));

    return txRow!;
  });
}

/**
 * Estimate fuer Pre-Run-Anzeige im Wizard. Liefert sowohl die voraussichtlich
 * benoetigten Credits (= Anzahl Leads die ein Video bekommen werden) als
 * auch ob das aktuelle Guthaben reicht.
 */
export async function estimateRunCost(input: {
  userId: string;
  leadCount: number;
  pricePerVideo?: number;
}): Promise<{
  cost: number;
  available: number;
  sufficient: boolean;
  shortfall: number;
}> {
  const price = input.pricePerVideo ?? 1;
  const cost = input.leadCount * price;
  const { balance: available } = await getBalance(input.userId);
  const sufficient = available >= cost;
  const shortfall = sufficient ? 0 : cost - available;
  return { cost, available, sufficient, shortfall };
}

/**
 * Liste der letzten N Transaktionen fuer den Verlauf in der UI.
 */
export async function listTransactions(input: {
  userId: string;
  limit?: number;
}): Promise<CreditTransaction[]> {
  const limit = Math.min(input.limit ?? 50, 200);
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, input.userId))
    .orderBy(sql`${creditTransactions.createdAt} DESC`)
    .limit(limit);
}
