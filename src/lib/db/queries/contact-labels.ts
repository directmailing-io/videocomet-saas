/**
 * Kontakt-Labels (Migration 0069).
 *
 * Frei benennbare Markierungen für Kontakte — manuell per Bulk-Aktion
 * oder automatisch (Runden-Start "Versand 28.08.2026", Versandzentrale
 * Versendet/Rückläufer). Namen sind pro User case-insensitiv eindeutig;
 * getOrCreate ist die einzige Anlage-Stelle, damit Auto-Label-Pfade
 * niemals Duplikate erzeugen.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contactLabels,
  contactLabelAssignments,
  contacts,
  type ContactLabel,
} from "@/lib/db/schema";

export interface ContactLabelUi {
  id: string;
  name: string;
  color: string;
  /** Wie viele Kontakte tragen dieses Label. */
  contactCount: number;
}

export async function listContactLabels(userId: string): Promise<ContactLabelUi[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    color: string;
    contact_count: number;
  }>(sql`
    SELECT cl.id, cl.name, cl.color,
           COALESCE((
             SELECT COUNT(*)::int
             FROM ${contactLabelAssignments} a
             JOIN ${contacts} c ON c.id = a.contact_id AND c.deleted_at IS NULL
             WHERE a.label_id = cl.id
           ), 0) AS contact_count
    FROM ${contactLabels} cl
    WHERE cl.user_id = ${userId}
    ORDER BY LOWER(cl.name) ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    contactCount: r.contact_count,
  }));
}

/** Label per Name holen oder anlegen (case-insensitiv, race-sicher). */
export async function getOrCreateContactLabel(input: {
  userId: string;
  name: string;
  color?: string;
}): Promise<ContactLabel> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Label-Name darf nicht leer sein.");
  const color = input.color ?? "#AA8CF5";

  const findByName = () =>
    db
      .select()
      .from(contactLabels)
      .where(
        and(
          eq(contactLabels.userId, input.userId),
          sql`LOWER(${contactLabels.name}) = LOWER(${name})`,
        ),
      )
      .limit(1);

  const [existing] = await findByName();
  if (existing) return existing;

  try {
    const [row] = await db
      .insert(contactLabels)
      .values({ userId: input.userId, name, color })
      .returning();
    return row;
  } catch {
    // Unique-Race: parallel angelegt — nochmal lesen.
    const [retry] = await findByName();
    if (!retry) throw new Error("Label konnte nicht angelegt werden.");
    return retry;
  }
}

/**
 * Label an Kontakte vergeben. Prüft Ownership beider Seiten;
 * ON CONFLICT DO NOTHING macht Doppel-Vergabe idempotent.
 * Liefert die Anzahl NEU markierter Kontakte.
 */
export async function assignLabelToContacts(input: {
  userId: string;
  labelId: string;
  contactIds: string[];
}): Promise<number> {
  if (input.contactIds.length === 0) return 0;
  const [label] = await db
    .select({ id: contactLabels.id })
    .from(contactLabels)
    .where(and(eq(contactLabels.id, input.labelId), eq(contactLabels.userId, input.userId)))
    .limit(1);
  if (!label) throw new Error("Dieses Label gibt es nicht mehr.");

  const idsSql = sql.join(
    input.contactIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const res = await db.execute<{ contact_id: string }>(sql`
    INSERT INTO ${contactLabelAssignments} (contact_id, label_id)
    SELECT c.id, ${input.labelId}::uuid
    FROM ${contacts} c
    WHERE c.user_id = ${input.userId}
      AND c.deleted_at IS NULL
      AND c.id = ANY(ARRAY[${idsSql}])
    ON CONFLICT DO NOTHING
    RETURNING contact_id
  `);
  return res.length;
}

/** Label von Kontakten entfernen. Liefert Anzahl entfernter Zuordnungen. */
export async function removeLabelFromContacts(input: {
  userId: string;
  labelId: string;
  contactIds: string[];
}): Promise<number> {
  if (input.contactIds.length === 0) return 0;
  const idsSql = sql.join(
    input.contactIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const res = await db.execute<{ contact_id: string }>(sql`
    DELETE FROM ${contactLabelAssignments} a
    USING ${contactLabels} cl
    WHERE a.label_id = cl.id
      AND cl.id = ${input.labelId}
      AND cl.user_id = ${input.userId}
      AND a.contact_id = ANY(ARRAY[${idsSql}])
    RETURNING a.contact_id
  `);
  return res.length;
}

/** Label komplett löschen (Zuordnungen kaskadieren). */
export async function deleteContactLabel(input: {
  userId: string;
  labelId: string;
}): Promise<boolean> {
  const res = await db
    .delete(contactLabels)
    .where(and(eq(contactLabels.id, input.labelId), eq(contactLabels.userId, input.userId)))
    .returning({ id: contactLabels.id });
  return res.length > 0;
}
