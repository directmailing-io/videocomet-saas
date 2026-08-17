/**
 * 3-Ebenen-Duplikat-Check für den neuen Runden-Wizard (v4, Etappe 1).
 *
 * Für jede Zeile aus einem CSV-Upload wird geprüft:
 *   - `in-batch`             — Zeile kommt in derselben Datei mehrfach vor
 *                              (der ERSTE Treffer bleibt fresh, alle weiteren
 *                              werden in-batch markiert)
 *   - `existing-contact`     — Match zu einem bestehenden Contact des Users
 *                              (per gewähltem Primärschlüssel)
 *   - `previously-contacted` — Der Contact war in den letzten N Tagen in
 *                              einer Runde (Standard: 90). Wir liefern die
 *                              Kampagne, den Runden-Namen und das Datum mit,
 *                              damit der User pro Kontakt entscheiden kann.
 *   - `fresh`                — Niemand ist schon da, kein Duplikat.
 *
 * Primärschlüssel-Optionen:
 *   - `email`         — normalized_email (lowercase)
 *   - `email_name`    — normalized_email + firstName + lastName (strikter)
 *   - `phone`         — Ziffern-only
 *
 * Rückgabe pro Zeile: DedupeResult (siehe Types).
 * Rückgabe gesamt: Zusammenfassung mit Counts pro Status.
 */

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, leads, runs, campaigns } from "@/lib/db/schema";

export type PrimaryKeyMode = "email" | "email_name" | "phone";

export type DedupeStatus =
  | "in-batch"
  | "existing-contact"
  | "previously-contacted"
  | "fresh";

export interface PreviousActivity {
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  sentAt: string; // ISO
  leadId: string;
}

export interface DedupeResult {
  rowIndex: number;
  status: DedupeStatus;
  /** Wenn `existing-contact` oder `previously-contacted`: die gefundene ID. */
  matchedContactId?: string;
  /** Wenn `existing-contact`: kompakte Vorschau der bestehenden Daten. */
  existingSnippet?: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
  };
  /** Wenn `previously-contacted`: eine oder mehrere frühere Runden. */
  previousActivities?: PreviousActivity[];
  /** Nur bei in-batch: Index der ersten Zeile mit demselben Schlüssel. */
  duplicateOfRowIndex?: number;
}

export interface DedupeSummary {
  total: number;
  inBatch: number;
  existingContact: number;
  previouslyContacted: number;
  fresh: number;
}

export interface DedupeCheckInput {
  userId: string;
  rows: Array<{
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  }>;
  primaryKey?: PrimaryKeyMode;
  /** Zeitraum für "previously-contacted"-Check in Tagen. Default 90. */
  contactedWithinDays?: number;
}

export interface DedupeCheckOutput {
  results: DedupeResult[];
  summary: DedupeSummary;
}

/** Normiert eine Zeile auf einen einheitlichen Match-Schlüssel. Null bedeutet
 *  "kein Schlüssel bildbar", der Check überspringt diese Zeile für die
 *  Existing/Previous-Prüfung (bleibt fresh außer sie ist in-batch doppelt).*/
function makeKey(
  row: DedupeCheckInput["rows"][number],
  mode: PrimaryKeyMode,
): string | null {
  const email = row.email?.trim().toLowerCase();
  const first = row.firstName?.trim().toLowerCase() ?? "";
  const last = row.lastName?.trim().toLowerCase() ?? "";
  const phoneDigits = row.phone?.replace(/\D+/g, "") ?? "";
  switch (mode) {
    case "email":
      return email && email.length > 0 ? "e:" + email : null;
    case "email_name":
      if (!email || email.length === 0) return null;
      if (!first && !last) return null;
      return "en:" + email + "|" + first + " " + last;
    case "phone":
      return phoneDigits.length >= 6 ? "p:" + phoneDigits : null;
  }
}

export async function checkDuplicates(
  input: DedupeCheckInput,
): Promise<DedupeCheckOutput> {
  const {
    userId,
    rows,
    primaryKey = "email",
    contactedWithinDays = 90,
  } = input;

  // 1) In-Batch: pro Row den Schlüssel bilden und den ersten Treffer merken.
  const firstSeenAtIndex = new Map<string, number>();
  const rowKeys: Array<string | null> = rows.map((r) => makeKey(r, primaryKey));

  const inBatch = new Set<number>(); // rowIndex der duplicates innerhalb der Datei
  const duplicateOfIndex = new Map<number, number>();
  rowKeys.forEach((key, idx) => {
    if (!key) return;
    if (firstSeenAtIndex.has(key)) {
      inBatch.add(idx);
      duplicateOfIndex.set(idx, firstSeenAtIndex.get(key)!);
    } else {
      firstSeenAtIndex.set(key, idx);
    }
  });

  // 2) Existing-Contact: Batch-Lookup aller einzigartigen Schlüssel gegen die
  //    contacts-Tabelle. Ergebnis: Map key → ContactRow.
  const uniqueEmails = new Set<string>();
  const uniquePhoneDigits = new Set<string>();
  for (const key of rowKeys) {
    if (!key) continue;
    if (key.startsWith("e:")) uniqueEmails.add(key.slice(2));
    if (key.startsWith("en:")) {
      // "en:email|first last"
      const emailPart = key.slice(3).split("|")[0];
      if (emailPart) uniqueEmails.add(emailPart);
    }
    if (key.startsWith("p:")) uniquePhoneDigits.add(key.slice(2));
  }

  type ExistingContactRow = {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company_display: string | null;
    company: string | null;
    phone: string | null;
  };

  const existingByEmail = new Map<string, ExistingContactRow>();
  const existingByPhone = new Map<string, ExistingContactRow>();

  if (uniqueEmails.size > 0) {
    const emailArr = Array.from(uniqueEmails);
    const emailSql = sql.join(
      emailArr.map((v) => sql`${v}::text`),
      sql`, `,
    );
    const rows = await db.execute<ExistingContactRow>(sql`
      SELECT id, email, first_name, last_name, company_display, company, phone
        FROM ${contacts}
       WHERE user_id = ${userId}
         AND deleted_at IS NULL
         AND email = ANY(ARRAY[${emailSql}])
    `);
    for (const r of rows) {
      if (r.email) existingByEmail.set(r.email, r);
    }
  }

  if (uniquePhoneDigits.size > 0) {
    const phoneArr = Array.from(uniquePhoneDigits);
    const phoneSql = sql.join(
      phoneArr.map((v) => sql`${v}::text`),
      sql`, `,
    );
    const rows = await db.execute<ExistingContactRow>(sql`
      SELECT id, email, first_name, last_name, company_display, company, phone
        FROM ${contacts}
       WHERE user_id = ${userId}
         AND deleted_at IS NULL
         AND phone IS NOT NULL
         AND regexp_replace(phone, '\D+', '', 'g') = ANY(ARRAY[${phoneSql}])
    `);
    for (const r of rows) {
      const digits = r.phone?.replace(/\D+/g, "") ?? "";
      if (digits) existingByPhone.set(digits, r);
    }
  }

  function findExisting(rowIdx: number): ExistingContactRow | null {
    const key = rowKeys[rowIdx];
    if (!key) return null;
    if (key.startsWith("e:")) return existingByEmail.get(key.slice(2)) ?? null;
    if (key.startsWith("en:")) {
      const [emailPart, namePart] = key.slice(3).split("|");
      const cand = existingByEmail.get(emailPart);
      if (!cand) return null;
      // Bei email_name muss zusätzlich der Name zumindest teilweise passen
      const candName =
        ((cand.first_name ?? "") + " " + (cand.last_name ?? "")).toLowerCase().trim();
      const wantName = namePart?.trim();
      if (!wantName) return null;
      return candName === wantName ? cand : null;
    }
    if (key.startsWith("p:")) return existingByPhone.get(key.slice(2)) ?? null;
    return null;
  }

  // 3) Previously-Contacted: für jeden gefundenen existing-contact schauen,
  //    ob er in den letzten N Tagen in einer Runde war. Nur EINEN Sammel-
  //    Query mit IN-Liste.
  const existingContactIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    if (inBatch.has(i)) continue;
    const e = findExisting(i);
    if (e) existingContactIds.add(e.id);
  }

  type PrevActivityRow = {
    contact_id: string;
    lead_id: string;
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    run_name: string;
    sent_at: string;
  };
  const activitiesByContact = new Map<string, PreviousActivity[]>();
  if (existingContactIds.size > 0) {
    const cutoff = new Date(Date.now() - contactedWithinDays * 86400_000).toISOString();
    const idArr = Array.from(existingContactIds);
    const idSql = sql.join(
      idArr.map((v) => sql`${v}::uuid`),
      sql`, `,
    );
    const rows = await db.execute<PrevActivityRow>(sql`
      SELECT l.contact_id, l.id AS lead_id,
             l.campaign_id, c.name AS campaign_name,
             l.run_id, r.name AS run_name,
             COALESCE(l.completed_at, l.started_at, l.created_at)::text AS sent_at
        FROM ${leads} l
        JOIN ${runs} r ON r.id = l.run_id
        JOIN ${campaigns} c ON c.id = l.campaign_id
       WHERE l.contact_id = ANY(ARRAY[${idSql}])
         AND l.removed_at IS NULL
         AND COALESCE(l.completed_at, l.started_at, l.created_at) >= ${cutoff}::timestamptz
       ORDER BY COALESCE(l.completed_at, l.started_at, l.created_at) DESC
    `);
    for (const r of rows) {
      const list = activitiesByContact.get(r.contact_id) ?? [];
      list.push({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        runId: r.run_id,
        runName: r.run_name,
        sentAt: r.sent_at,
        leadId: r.lead_id,
      });
      activitiesByContact.set(r.contact_id, list);
    }
  }

  // 4) Ergebnis pro Row zusammensetzen.
  const results: DedupeResult[] = rows.map((_row, idx) => {
    if (inBatch.has(idx)) {
      return {
        rowIndex: idx,
        status: "in-batch",
        duplicateOfRowIndex: duplicateOfIndex.get(idx),
      };
    }
    const existing = findExisting(idx);
    if (!existing) {
      return { rowIndex: idx, status: "fresh" };
    }
    const activities = activitiesByContact.get(existing.id) ?? [];
    const snippet = {
      email: existing.email,
      firstName: existing.first_name,
      lastName: existing.last_name,
      company: existing.company_display ?? existing.company,
    };
    if (activities.length > 0) {
      return {
        rowIndex: idx,
        status: "previously-contacted",
        matchedContactId: existing.id,
        existingSnippet: snippet,
        previousActivities: activities,
      };
    }
    return {
      rowIndex: idx,
      status: "existing-contact",
      matchedContactId: existing.id,
      existingSnippet: snippet,
    };
  });

  const summary: DedupeSummary = {
    total: results.length,
    inBatch: 0,
    existingContact: 0,
    previouslyContacted: 0,
    fresh: 0,
  };
  for (const r of results) {
    if (r.status === "in-batch") summary.inBatch++;
    else if (r.status === "existing-contact") summary.existingContact++;
    else if (r.status === "previously-contacted") summary.previouslyContacted++;
    else summary.fresh++;
  }

  return { results, summary };
}
