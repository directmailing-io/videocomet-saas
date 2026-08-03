/**
 * Abo-Ende-Cleanup-Sweep (Migration 0040).
 *
 * Tickt beim Boot + alle 6h. Vier Phasen pro Tick:
 *  1. ENTER:    Abo endgueltig vorbei (canceled/unpaid + Periodenende
 *               erreicht) → Zyklus-Row anlegen/resetten + Ankuendigungs-Mail
 *               (Loeschung in 30 Tagen).
 *  2. ABORT:    User ist wieder aktiv (oder Periodenende in der Zukunft)
 *               → Zyklus per canceledAt abbrechen, nichts loeschen.
 *  3. REMINDER: 7 Tage vor deleteAfter → Erinnerungs-Mail.
 *  4. DELETE:   deleteAfter erreicht → Content-Cascade
 *               (account-cleanup-service) + Bestaetigungs-Mail.
 *
 * Idempotenz: Mail-Versand claimt zuerst den Timestamp (UPDATE ... WHERE
 * timestamp IS NULL, RETURNING). Schlaegt der Versand fehl, wird der Claim
 * zurueckgerollt → naechster Tick versucht es erneut. Kein Mail-Spam, keine
 * verlorenen Mails (ausser Crash exakt zwischen Send und Commit).
 *
 * Ausgeschlossen: Admins und Never-Payer (subscriptionStatus NULL — die
 * haben nie bezahlt und nie Content generieren koennen).
 */

import { and, eq, inArray, isNull, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountCleanupState, users } from "@/lib/db/schema";
import { deleteUserContent } from "@/lib/billing/account-cleanup-service";
import {
  sendAccountCleanupNoticeMail,
  sendAccountCleanupReminderMail,
  sendAccountCleanupDoneMail,
} from "@/lib/mail";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // alle 6h
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage Frist
const REMINDER_BEFORE_MS = 7 * 24 * 60 * 60 * 1000; // Erinnerung 7 Tage vorher

function log(level: "info" | "warn" | "error", msg: string): void {
  // eslint-disable-next-line no-console
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[account-cleanup] ${msg}`);
}

/** Phase 1: neue Cleanup-Zyklen anlegen + Ankuendigungs-Mail. */
async function phaseEnter(now: Date): Promise<void> {
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      periodEnd: users.subscriptionCurrentPeriodEnd,
      stateCanceledAt: accountCleanupState.canceledAt,
      stateDeletedAt: accountCleanupState.deletedAt,
      stateUserId: accountCleanupState.userId,
    })
    .from(users)
    .leftJoin(accountCleanupState, eq(accountCleanupState.userId, users.id))
    .where(
      and(
        eq(users.role, "user"),
        inArray(users.subscriptionStatus, ["canceled", "unpaid"]),
        isNotNull(users.subscriptionCurrentPeriodEnd),
        lt(users.subscriptionCurrentPeriodEnd, now),
        // Kein AKTIVER Zyklus (Row fehlt, oder alter Zyklus wurde
        // abgebrochen/abgeschlossen → Reset erlaubt).
        or(
          isNull(accountCleanupState.userId),
          isNotNull(accountCleanupState.canceledAt),
          isNotNull(accountCleanupState.deletedAt),
        ),
      ),
    );

  for (const u of candidates) {
    const endedAt = u.periodEnd ?? now;
    // Fairness-Guard: mindestens 30 Tage AB JETZT (Ankuendigung), auch wenn
    // das Periodenende laenger zurueckliegt (Altbestand vor diesem Feature).
    const deleteAfter = new Date(
      Math.max(endedAt.getTime() + RETENTION_MS, now.getTime() + RETENTION_MS),
    );

    await db
      .insert(accountCleanupState)
      .values({
        userId: u.id,
        subscriptionEndedAt: endedAt,
        deleteAfter,
      })
      .onConflictDoUpdate({
        target: accountCleanupState.userId,
        set: {
          subscriptionEndedAt: endedAt,
          deleteAfter,
          noticeSentAt: null,
          reminderSentAt: null,
          deletedAt: null,
          canceledAt: null,
          createdAt: now,
        },
      });

    // Mail-Claim + Versand
    const claimed = await db
      .update(accountCleanupState)
      .set({ noticeSentAt: now })
      .where(
        and(
          eq(accountCleanupState.userId, u.id),
          isNull(accountCleanupState.noticeSentAt),
        ),
      )
      .returning({ userId: accountCleanupState.userId });
    if (claimed.length === 1) {
      try {
        await sendAccountCleanupNoticeMail({
          to: u.email,
          firstName: u.firstName,
          deleteDate: deleteAfter,
        });
        log("info", `notice sent user=${u.id} deleteAfter=${deleteAfter.toISOString()}`);
      } catch (err) {
        await db
          .update(accountCleanupState)
          .set({ noticeSentAt: null })
          .where(eq(accountCleanupState.userId, u.id));
        log("error", `notice mail failed user=${u.id}: ${(err as Error)?.message ?? err}`);
      }
    }
  }
}

/** Phase 2: Zyklen abbrechen, deren User wieder aktiv sind. */
async function phaseAbort(now: Date): Promise<void> {
  const aborted = await db
    .update(accountCleanupState)
    .set({ canceledAt: now })
    .where(
      and(
        isNull(accountCleanupState.canceledAt),
        isNull(accountCleanupState.deletedAt),
        inArray(
          accountCleanupState.userId,
          db
            .select({ id: users.id })
            .from(users)
            .where(
              or(
                inArray(users.subscriptionStatus, ["active", "trialing", "past_due"]),
                sql`${users.subscriptionCurrentPeriodEnd} > now()`,
              ),
            ),
        ),
      ),
    )
    .returning({ userId: accountCleanupState.userId });
  for (const a of aborted) {
    log("info", `cycle aborted (user active again) user=${a.userId}`);
  }
}

/** Phase 3: Erinnerungs-Mail 7 Tage vor Loeschung. */
async function phaseReminder(now: Date): Promise<void> {
  const due = await db
    .select({
      userId: accountCleanupState.userId,
      deleteAfter: accountCleanupState.deleteAfter,
      email: users.email,
      firstName: users.firstName,
    })
    .from(accountCleanupState)
    .innerJoin(users, eq(users.id, accountCleanupState.userId))
    .where(
      and(
        isNull(accountCleanupState.canceledAt),
        isNull(accountCleanupState.deletedAt),
        isNotNull(accountCleanupState.noticeSentAt),
        isNull(accountCleanupState.reminderSentAt),
        lte(
          accountCleanupState.deleteAfter,
          new Date(now.getTime() + REMINDER_BEFORE_MS),
        ),
      ),
    );

  for (const d of due) {
    const claimed = await db
      .update(accountCleanupState)
      .set({ reminderSentAt: now })
      .where(
        and(
          eq(accountCleanupState.userId, d.userId),
          isNull(accountCleanupState.reminderSentAt),
        ),
      )
      .returning({ userId: accountCleanupState.userId });
    if (claimed.length !== 1) continue;
    try {
      await sendAccountCleanupReminderMail({
        to: d.email,
        firstName: d.firstName,
        deleteDate: d.deleteAfter,
      });
      log("info", `reminder sent user=${d.userId}`);
    } catch (err) {
      await db
        .update(accountCleanupState)
        .set({ reminderSentAt: null })
        .where(eq(accountCleanupState.userId, d.userId));
      log("error", `reminder mail failed user=${d.userId}: ${(err as Error)?.message ?? err}`);
    }
  }
}

/** Phase 4: Loeschung durchfuehren + Bestaetigungs-Mail. */
async function phaseDelete(now: Date): Promise<void> {
  const due = await db
    .select({
      userId: accountCleanupState.userId,
      email: users.email,
      firstName: users.firstName,
    })
    .from(accountCleanupState)
    .innerJoin(users, eq(users.id, accountCleanupState.userId))
    .where(
      and(
        isNull(accountCleanupState.canceledAt),
        isNull(accountCleanupState.deletedAt),
        isNotNull(accountCleanupState.noticeSentAt),
        lt(accountCleanupState.deleteAfter, now),
      ),
    );

  for (const d of due) {
    try {
      const result = await deleteUserContent(d.userId);
      log(
        "info",
        `content deleted user=${d.userId} leads=${result.leadsDeleted} media=${result.mediaItemsDeleted} campaigns=${result.campaignsSoftDeleted} lpVersions=${result.lpVersionsDeleted} lpFiles=${result.lpFilesDeleted}${result.lpFilesFailed > 0 ? ` lpFilesFailed=${result.lpFilesFailed}` : ""}`,
      );
    } catch (err) {
      log("error", `delete cascade failed user=${d.userId}: ${(err as Error)?.message ?? err}`);
      continue; // naechster Tick versucht es erneut (Cascade ist idempotent)
    }

    const claimed = await db
      .update(accountCleanupState)
      .set({ deletedAt: now })
      .where(
        and(
          eq(accountCleanupState.userId, d.userId),
          isNull(accountCleanupState.deletedAt),
        ),
      )
      .returning({ userId: accountCleanupState.userId });
    if (claimed.length !== 1) continue;

    try {
      await sendAccountCleanupDoneMail({ to: d.email, firstName: d.firstName });
    } catch (err) {
      // Loeschung ist durch — Mail-Fehler nur loggen, kein Rollback (sonst
      // wuerde der naechste Tick die Cascade sinnlos wiederholen).
      log("error", `done mail failed user=${d.userId}: ${(err as Error)?.message ?? err}`);
    }
  }
}

export async function runAccountCleanupTick(): Promise<void> {
  const now = new Date();
  await phaseAbort(now); // zuerst: Reaktivierungen respektieren
  await phaseEnter(now);
  await phaseReminder(now);
  await phaseDelete(now);
}

export function startAccountCleanup(): () => void {
  void runAccountCleanupTick().catch((err) => {
    log("error", `initial tick crashed: ${(err as Error)?.message ?? err}`);
  });
  const t = setInterval(() => {
    runAccountCleanupTick().catch((err) => {
      log("error", `periodic tick crashed: ${(err as Error)?.message ?? err}`);
    });
  }, SWEEP_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
