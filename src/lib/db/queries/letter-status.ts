/**
 * Brief-Versandstatus (Versandzentrale, Migration 0067).
 *
 * Statusmodell pro Lead: 'open' → 'in_progress' → 'sent' (beide Richtungen
 * erlaubt, jede Änderung protokolliert). Der Status ändert sich NIE
 * automatisch — Exporte setzen nur `letter_exported_at`, der User
 * entscheidet danach im Dialog. So bleiben Test-Exporte statistik-neutral.
 *
 * Jede Mutation schreibt lead_events (letter_exported / letter_sent /
 * letter_status_changed) in DERSELBEN Transaktion wie das Spalten-Update
 * und zieht contacts.last_activity_at mit (der 0054-Trigger hört nur auf
 * Tracking-Spalten, nicht auf die Brief-Felder).
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, leadEvents, leads, runs } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LetterStatus = "open" | "in_progress" | "sent";

export type LetterAction =
  | { action: "status"; status: LetterStatus; sentAt?: Date }
  | { action: "plan"; plannedAt: Date | null }
  | { action: "returned"; returned: boolean };

export interface BulkLetterResult {
  updated: number;
  skipped: number;
}

async function assertRunOwnership(runId: string, userId: string): Promise<void> {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  if (!run) throw new Error("Not found");
}

/** contacts.last_activity_at für alle betroffenen Leads hochziehen. */
async function touchContacts(
  tx: Tx,
  leadIds: string[],
  ts: Date,
): Promise<void> {
  if (leadIds.length === 0) return;
  await tx
    .update(contacts)
    .set({
      lastActivityAt: sql`GREATEST(COALESCE(${contacts.lastActivityAt}, 'epoch'::timestamptz), ${ts})`,
    })
    .where(
      inArray(
        contacts.id,
        tx
          .select({ id: leads.contactId })
          .from(leads)
          .where(and(inArray(leads.id, leadIds), isNotNull(leads.contactId))),
      ),
    );
}

/**
 * Bulk-Statuswechsel / Planungs- / Rückläufer-Markierung für Leads einer
 * Runde. Nur completed-Leads werden angefasst (Race-Guard gegen laufende
 * Regeneration); alles andere zählt als `skipped`.
 */
export async function bulkApplyLetterAction(
  runId: string,
  userId: string,
  leadIds: string[],
  action: LetterAction,
): Promise<BulkLetterResult> {
  await assertRunOwnership(runId, userId);
  if (leadIds.length === 0) return { updated: 0, skipped: 0 };

  return db.transaction(async (tx) => {
    // Aktuelle Zustände lesen — für Event-Payload (from → to) und um
    // No-Ops zu überspringen.
    const rows = await tx
      .select({
        id: leads.id,
        status: leads.status,
        letterStatus: leads.letterStatus,
        letterSentAt: leads.letterSentAt,
        letterExportedAt: leads.letterExportedAt,
      })
      .from(leads)
      .where(and(eq(leads.runId, runId), inArray(leads.id, leadIds)));

    const eligible = rows.filter((r) => r.status === "completed");
    const skipped = leadIds.length - eligible.length;
    if (eligible.length === 0) return { updated: 0, skipped };

    const now = new Date();
    const ids = eligible.map((r) => r.id);

    if (action.action === "status") {
      const to = action.status;
      const sentAt = to === "sent" ? (action.sentAt ?? now) : null;
      const changed = eligible.filter(
        (r) =>
          r.letterStatus !== to ||
          (to === "sent" &&
            sentAt &&
            r.letterSentAt?.getTime() !== sentAt.getTime()),
      );
      if (changed.length === 0) return { updated: 0, skipped };
      const changedIds = changed.map((r) => r.id);

      await tx
        .update(leads)
        .set({ letterStatus: to, letterSentAt: sentAt })
        .where(inArray(leads.id, changedIds));

      await tx.insert(leadEvents).values(
        changed.map((r) => ({
          leadId: r.id,
          kind: to === "sent" ? "letter_sent" : "letter_status_changed",
          ts: now,
          payload: {
            from: r.letterStatus,
            to,
            ...(sentAt ? { sentAt: sentAt.toISOString() } : {}),
          },
        })),
      );

      await touchContacts(tx, changedIds, now);
      return { updated: changed.length, skipped: skipped + eligible.length - changed.length };
    }

    if (action.action === "plan") {
      await tx
        .update(leads)
        .set({ letterPlannedAt: action.plannedAt })
        .where(inArray(leads.id, ids));
      // Reine Erinnerung — kein CRM-Event, kein last_activity_at-Bump.
      return { updated: ids.length, skipped };
    }

    // action === "returned"
    const returnedAt = action.returned ? now : null;
    await tx
      .update(leads)
      .set({ letterReturnedAt: returnedAt })
      .where(inArray(leads.id, ids));
    await tx.insert(leadEvents).values(
      ids.map((id) => ({
        leadId: id,
        kind: "letter_status_changed",
        ts: now,
        payload: action.returned
          ? { returned: true }
          : { returned: false },
      })),
    );
    await touchContacts(tx, ids, now);
    return { updated: ids.length, skipped };
  });
}

/**
 * Nach erfolgreichem Bundle-Export aufrufen: setzt `letter_exported_at`
 * und protokolliert `letter_exported`. Ändert NIE den Status — ein Export
 * kann auch ein Test sein; der User entscheidet danach im Dialog.
 * Fire-and-forget-sicher: wirft nie (Export-Download darf daran nicht
 * scheitern).
 */
export async function markLeadsExported(
  leadIds: string[],
  meta: { runId: string; total: number; partial: boolean },
): Promise<void> {
  if (leadIds.length === 0) return;
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set({ letterExportedAt: now })
        .where(and(eq(leads.runId, meta.runId), inArray(leads.id, leadIds)));
      await tx.insert(leadEvents).values(
        leadIds.map((id) => ({
          leadId: id,
          kind: "letter_exported",
          ts: now,
          payload: {
            exported: leadIds.length,
            total: meta.total,
            partial: meta.partial,
          },
        })),
      );
    });
  } catch (err) {
    console.warn(
      `[letter-status] markLeadsExported failed for run=${meta.runId}:`,
      err instanceof Error ? err.message : "unknown",
    );
  }
}
