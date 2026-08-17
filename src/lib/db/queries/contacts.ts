/**
 * Query-Layer für die Mini-CRM-Kontakte (Migration 0054).
 *
 * Diese Queries arbeiten auf der neuen `contacts`-Tabelle. Bestehender
 * Code in `src/lib/leads/global-list.ts` bleibt für Rückwärts-Kompatibilität
 * — er aggregiert on-the-fly aus `leads`. Sobald das UI komplett umgestellt
 * ist, wird der alte Pfad entfernt.
 *
 * Alle Queries sind user-scoped. Deleted-Contacts (deleted_at IS NOT NULL)
 * werden in Listen-Queries ausgeblendet.
 */

import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contacts,
  contactLists,
  contactFields,
  leadEvents,
  leads,
  listMemberships,
  runs,
  campaigns,
  type ContactRow,
  type ContactListRow,
} from "@/lib/db/schema";
import type { FilterDefinition } from "@/lib/contacts/filter";
import { buildFilterSql } from "@/lib/contacts/filter-query";

/** UI-fokussierte Kontakt-Zeile für die Tabelle. */
export interface ContactRowUi {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  company: string | null;
  companyDisplay: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  data: Record<string, string>;
  lastActivityAt: string | null;
  createdAt: string;
  // Aggregate aus verknüpften Leads (per Sub-Query gerechnet).
  campaignCount: number;
  runCount: number;
  totalOpens: number;
  totalPlays: number;
  totalCta: number;
  // Listen-Mitgliedschaft (Namen zum Anzeigen als Chips).
  listNames: string[];
}

export interface ContactListUi {
  id: string;
  name: string;
  description: string | null;
  type: "static" | "smart";
  color: string | null;
  icon: string | null;
  contactCount: number;
  autoRunCampaignId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Listet Kontakte eines Users mit optionalem Filter auf eine Liste.
 * Aggregate (campaignCount, opens etc.) werden pro Row gerechnet — bei
 * &gt;5000 Kontakten sollte später ein Materialized View davorgeschaltet
 * werden (kommt in Etappe 4). Für Etappe 2 (Anzeige) ist diese Query ok.
 */
export async function listContacts(input: {
  userId: string;
  listId?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "recent" | "name" | "activity";
  /** Ad-hoc-Filter aus Etappe 4 — wird direkt in die WHERE-Klausel gemischt. */
  filter?: FilterDefinition | null;
}): Promise<{ contacts: ContactRowUi[]; total: number }> {
  const {
    userId,
    listId = null,
    search,
    limit = 100,
    offset = 0,
    sort = "activity",
    filter,
  } = input;

  // Alle WHERE-Bedingungen als raw SQL mit "c."-Alias, damit sie mit der
  // Aggregat-Query unten kompatibel sind (FROM contacts c).
  const whereFragments: SQL[] = [
    sql`c.user_id = ${userId}`,
    sql`c.deleted_at IS NULL`,
  ];

  if (listId) {
    whereFragments.push(sql`EXISTS (
      SELECT 1 FROM list_memberships lm
      WHERE lm.contact_id = c.id AND lm.list_id = ${listId}
    )`);
  }
  if (filter && filter.conditions.length > 0) {
    whereFragments.push(sql`(${buildFilterSql(filter, userId)})`);
  }
  if (search && search.length >= 2) {
    const term = `%${search.toLowerCase()}%`;
    whereFragments.push(sql`(
      LOWER(COALESCE(c.email, '')) LIKE ${term}
      OR LOWER(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE ${term}
      OR LOWER(COALESCE(c.company_display, c.company, '')) LIKE ${term}
    )`);
  }

  const whereExpr = whereFragments.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));

  const totalRes = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM ${contacts} c WHERE ${whereExpr}
  `);
  const total = totalRes[0]?.n ?? 0;

  const orderBy =
    sort === "name"
      ? sql`COALESCE(c.last_name, c.first_name, c.email) ASC`
      : sort === "recent"
        ? sql`c.created_at DESC`
        : sql`c.last_activity_at DESC NULLS LAST`;

  // Aggregate über raw SQL — Drizzle hat kein natives Sub-Select-Group-By.
  const rows = await db.execute<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    company_display: string | null;
    phone: string | null;
    linkedin_url: string | null;
    data: Record<string, string>;
    last_activity_at: string | null;
    created_at: string;
    campaign_count: number;
    run_count: number;
    total_opens: number;
    total_plays: number;
    total_cta: number;
    list_names: string[] | null;
  }>(sql`
    SELECT c.id, c.email, c.first_name, c.last_name, c.company, c.company_display,
           c.phone, c.linkedin_url, c.data, c.last_activity_at, c.created_at,
           COALESCE(agg.campaign_count, 0) AS campaign_count,
           COALESCE(agg.run_count, 0)      AS run_count,
           COALESCE(agg.total_opens, 0)    AS total_opens,
           COALESCE(agg.total_plays, 0)    AS total_plays,
           COALESCE(agg.total_cta, 0)      AS total_cta,
           lists.list_names
    FROM ${contacts} c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT l.campaign_id) AS campaign_count,
        COUNT(DISTINCT l.run_id)      AS run_count,
        SUM(l.view_count)             AS total_opens,
        SUM(l.play_count)             AS total_plays,
        SUM(l.cta_click_count)        AS total_cta
      FROM ${leads} l
      WHERE l.contact_id = c.id AND l.removed_at IS NULL
    ) agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(cl.name ORDER BY cl.name) AS list_names
      FROM ${listMemberships} lm
      JOIN ${contactLists} cl ON cl.id = lm.list_id
      WHERE lm.contact_id = c.id
    ) lists ON TRUE
    WHERE ${whereExpr}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `);

  const items: ContactRowUi[] = rows.map((r) => {
    const first = r.first_name?.trim() ?? "";
    const last = r.last_name?.trim() ?? "";
    const displayName =
      [first, last].filter(Boolean).join(" ") ||
      r.company_display ||
      r.email ||
      "Ohne Namen";
    return {
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      displayName,
      company: r.company,
      companyDisplay: r.company_display,
      phone: r.phone,
      linkedinUrl: r.linkedin_url,
      data: r.data ?? {},
      lastActivityAt: r.last_activity_at,
      createdAt: r.created_at,
      campaignCount: Number(r.campaign_count) || 0,
      runCount: Number(r.run_count) || 0,
      totalOpens: Number(r.total_opens) || 0,
      totalPlays: Number(r.total_plays) || 0,
      totalCta: Number(r.total_cta) || 0,
      listNames: r.list_names ?? [],
    };
  });

  return { contacts: items, total };
}

/**
 * Listen eines Users mit Contact-Count. Der `contact_count`-Wert der Tabelle
 * ist denormalisiert — wir prüfen hier zusätzlich per Sub-Query gegen
 * `list_memberships`, damit auch dann korrekt gezählt wird, wenn der Zähler
 * (durch einen alten Bug) aus dem Ruder gelaufen ist. Bei &lt;500 Listen
 * pro User ist der Aufwand vernachlässigbar.
 */
export async function listContactLists(input: {
  userId: string;
}): Promise<ContactListUi[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    type: "static" | "smart";
    color: string | null;
    icon: string | null;
    auto_run_campaign_id: string | null;
    contact_count: number;
    created_at: string;
    updated_at: string;
  }>(sql`
    SELECT cl.id, cl.name, cl.description, cl.type, cl.color, cl.icon,
           cl.auto_run_campaign_id,
           COALESCE(mc.n, 0)::int AS contact_count,
           cl.created_at, cl.updated_at
    FROM ${contactLists} cl
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n
      FROM ${listMemberships} lm
      JOIN ${contacts} c ON c.id = lm.contact_id AND c.deleted_at IS NULL
      WHERE lm.list_id = cl.id
    ) mc ON TRUE
    WHERE cl.user_id = ${input.userId}
    ORDER BY cl.name ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    color: r.color,
    icon: r.icon,
    contactCount: r.contact_count,
    autoRunCampaignId: r.auto_run_campaign_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Zählung „Alle Kontakte" für die Sidebar. */
export async function countContacts(userId: string): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), isNull(contacts.deletedAt)));
  return row[0]?.n ?? 0;
}

/** Erstellt eine neue statische Liste. Wirft bei Namens-Konflikt. */
export async function createContactList(input: {
  userId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}): Promise<ContactListRow> {
  const [row] = await db
    .insert(contactLists)
    .values({
      userId: input.userId,
      name: input.name.trim(),
      description: input.description ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      type: "static",
    })
    .returning();
  return row;
}

/** Umbenennen / Beschreibung ändern. */
export async function updateContactList(input: {
  userId: string;
  listId: string;
  patch: Partial<Pick<ContactListRow, "name" | "description" | "color" | "icon" | "autoRunCampaignId">>;
}): Promise<ContactListRow | null> {
  const cleaned: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.name !== undefined) cleaned.name = input.patch.name.trim();
  if (input.patch.description !== undefined) cleaned.description = input.patch.description;
  if (input.patch.color !== undefined) cleaned.color = input.patch.color;
  if (input.patch.icon !== undefined) cleaned.icon = input.patch.icon;
  if (input.patch.autoRunCampaignId !== undefined) {
    cleaned.autoRunCampaignId = input.patch.autoRunCampaignId;
  }

  const [row] = await db
    .update(contactLists)
    .set(cleaned)
    .where(and(eq(contactLists.id, input.listId), eq(contactLists.userId, input.userId)))
    .returning();
  return row ?? null;
}

/** Löscht eine Liste (cascade räumt list_memberships auf). */
export async function deleteContactList(input: {
  userId: string;
  listId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(contactLists)
    .where(and(eq(contactLists.id, input.listId), eq(contactLists.userId, input.userId)))
    .returning({ id: contactLists.id });
  return rows.length > 0;
}

/**
 * Fügt Contacts zu einer Liste hinzu. Idempotent: wenn Contact schon drin
 * ist, kein Fehler. Aktualisiert danach den denormalisierten Zähler.
 */
export async function addContactsToList(input: {
  userId: string;
  listId: string;
  contactIds: string[];
  via?: "manual" | "import" | "api" | "merge" | "filter" | "smart";
}): Promise<{ added: number }> {
  if (input.contactIds.length === 0) return { added: 0 };

  // Vor Insert die Contact-Ownership prüfen (kein Insert von fremden Contacts).
  const owned = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.userId, input.userId),
        isNull(contacts.deletedAt),
        inArray(contacts.id, input.contactIds),
      ),
    );
  const ids = owned.map((r) => r.id);
  if (ids.length === 0) return { added: 0 };

  const inserted = await db
    .insert(listMemberships)
    .values(
      ids.map((cid) => ({
        listId: input.listId,
        contactId: cid,
        userId: input.userId,
        addedVia: input.via ?? ("manual" as const),
      })),
    )
    .onConflictDoNothing()
    .returning({ contactId: listMemberships.contactId });

  await refreshContactCount(input.listId);
  return { added: inserted.length };
}

/** Entfernt Contacts aus einer Liste. */
export async function removeContactsFromList(input: {
  userId: string;
  listId: string;
  contactIds: string[];
}): Promise<{ removed: number }> {
  if (input.contactIds.length === 0) return { removed: 0 };

  const removed = await db
    .delete(listMemberships)
    .where(
      and(
        eq(listMemberships.listId, input.listId),
        eq(listMemberships.userId, input.userId),
        inArray(listMemberships.contactId, input.contactIds),
      ),
    )
    .returning({ contactId: listMemberships.contactId });

  await refreshContactCount(input.listId);
  return { removed: removed.length };
}

/** Aktualisiert `contactLists.contactCount` auf den tatsächlichen Wert. */
export async function refreshContactCount(listId: string): Promise<void> {
  await db.execute(sql`
    UPDATE ${contactLists} cl
       SET contact_count = COALESCE((
             SELECT COUNT(*)::int
             FROM ${listMemberships} lm
             JOIN ${contacts} c ON c.id = lm.contact_id AND c.deleted_at IS NULL
             WHERE lm.list_id = cl.id
           ), 0),
           updated_at = now()
     WHERE cl.id = ${listId}
  `);
}

/**
 * Basis-Info eines einzelnen Contacts + alle Occurrences (Leads). Für die
 * Detailansicht in Etappe 3 gedacht — hier schon bereitgestellt, damit
 * die API-Routen konsistent sind.
 */
export async function getContactDetail(input: {
  userId: string;
  contactId: string;
}): Promise<
  | ({
      contact: ContactRow;
      lists: ContactListUi[];
      occurrences: Array<{
        leadId: string;
        campaignId: string;
        campaignName: string;
        runId: string;
        runName: string;
        status: string;
        createdAt: string;
        completedAt: string | null;
        viewCount: number;
        playCount: number;
        ctaClickCount: number;
        pdfUrl: string | null;
        videoUrl: string | null;
        slug: string | null;
      }>;
      events: Array<{
        id: string;
        leadId: string;
        campaignName: string;
        runName: string;
        kind: string;
        ts: string;
        payload: Record<string, unknown> | null;
      }>;
    })
  | null
> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.userId, input.userId)))
    .limit(1);
  if (!contact) return null;

  const listRows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    type: "static" | "smart";
    color: string | null;
    icon: string | null;
    auto_run_campaign_id: string | null;
    contact_count: number;
    created_at: string;
    updated_at: string;
  }>(sql`
    SELECT cl.id, cl.name, cl.description, cl.type, cl.color, cl.icon,
           cl.auto_run_campaign_id, cl.contact_count,
           cl.created_at, cl.updated_at
    FROM ${listMemberships} lm
    JOIN ${contactLists} cl ON cl.id = lm.list_id
    WHERE lm.contact_id = ${input.contactId}
    ORDER BY cl.name ASC
  `);

  const occRows = await db.execute<{
    lead_id: string;
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    run_name: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    view_count: number;
    play_count: number;
    cta_click_count: number;
    pdf_url: string | null;
    video_url: string | null;
    slug: string | null;
  }>(sql`
    SELECT l.id AS lead_id, l.campaign_id, c.name AS campaign_name,
           l.run_id, r.name AS run_name, l.status,
           l.created_at, l.completed_at,
           l.view_count, l.play_count, l.cta_click_count,
           l.pdf_url, l.video_url, l.slug
    FROM ${leads} l
    JOIN ${runs} r ON r.id = l.run_id
    JOIN ${campaigns} c ON c.id = l.campaign_id
    WHERE l.contact_id = ${input.contactId} AND l.removed_at IS NULL
    ORDER BY l.created_at DESC
  `);

  // Letzte 50 Events über alle Occurrences dieses Contacts.
  const eventRows = await db.execute<{
    id: string;
    lead_id: string;
    campaign_name: string;
    run_name: string;
    kind: string;
    ts: string;
    payload: Record<string, unknown> | null;
  }>(sql`
    SELECT le.id, le.lead_id, c.name AS campaign_name, r.name AS run_name,
           le.kind, le.ts, le.payload
    FROM ${leadEvents} le
    JOIN ${leads} l ON l.id = le.lead_id
    JOIN ${runs} r ON r.id = l.run_id
    JOIN ${campaigns} c ON c.id = l.campaign_id
    WHERE l.contact_id = ${input.contactId}
    ORDER BY le.ts DESC
    LIMIT 50
  `);

  return {
    contact,
    lists: listRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      color: r.color,
      icon: r.icon,
      contactCount: r.contact_count,
      autoRunCampaignId: r.auto_run_campaign_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    events: eventRows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      campaignName: r.campaign_name,
      runName: r.run_name,
      kind: r.kind,
      ts: r.ts,
      payload: r.payload,
    })),
    occurrences: occRows.map((r) => ({
      leadId: r.lead_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      runId: r.run_id,
      runName: r.run_name,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      viewCount: r.view_count,
      playCount: r.play_count,
      ctaClickCount: r.cta_click_count,
      pdfUrl: r.pdf_url,
      videoUrl: r.video_url,
      slug: r.slug,
    })),
  };
}

/** Update eines einzelnen Contacts (inline-edit). */
export async function updateContact(input: {
  userId: string;
  contactId: string;
  patch: Partial<{
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    company: string | null;
    companyDisplay: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    data: Record<string, string>;
  }>;
}): Promise<ContactRow | null> {
  const cleaned: Record<string, unknown> = { updatedAt: new Date() };
  const p = input.patch;
  if (p.firstName !== undefined) cleaned.firstName = p.firstName;
  if (p.lastName !== undefined) cleaned.lastName = p.lastName;
  if (p.email !== undefined) cleaned.email = p.email ? p.email.toLowerCase().trim() : null;
  if (p.company !== undefined) cleaned.company = p.company;
  if (p.companyDisplay !== undefined) cleaned.companyDisplay = p.companyDisplay;
  if (p.phone !== undefined) cleaned.phone = p.phone;
  if (p.linkedinUrl !== undefined) cleaned.linkedinUrl = p.linkedinUrl;
  if (p.data !== undefined) cleaned.data = p.data;

  const [row] = await db
    .update(contacts)
    .set(cleaned)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.userId, input.userId)))
    .returning();
  return row ?? null;
}

/** Soft-Delete eines Contacts. Kaskade zu list_memberships passiert
 *  automatisch (FK ON DELETE CASCADE), zu leads.contact_id via SET NULL. */
export async function softDeleteContact(input: {
  userId: string;
  contactId: string;
  reason?: string;
}): Promise<boolean> {
  const rows = await db
    .update(contacts)
    .set({
      deletedAt: new Date(),
      deletedReason: input.reason ?? "user_deleted",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contacts.id, input.contactId),
        eq(contacts.userId, input.userId),
        isNull(contacts.deletedAt),
      ),
    )
    .returning({ id: contacts.id });
  return rows.length > 0;
}

/**
 * Führt zwei Contacts zusammen: der "loser" (source) wird gelöscht, alle
 * seine Leads und Listen-Memberships wandern zum "winner" (target).
 * Basis-Daten des Winners bleiben; nur leere Felder werden mit den Werten
 * des Losers befüllt.
 */
export async function mergeContacts(input: {
  userId: string;
  winnerId: string;
  loserId: string;
}): Promise<boolean> {
  if (input.winnerId === input.loserId) return false;

  const [winner, loser] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.winnerId), eq(contacts.userId, input.userId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.loserId), eq(contacts.userId, input.userId)))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);
  if (!winner || !loser) return false;

  // Basis-Daten: leere Winner-Felder mit Loser-Werten überschreiben.
  const enrichPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (!winner.email && loser.email) enrichPatch.email = loser.email;
  if (!winner.firstName && loser.firstName) enrichPatch.firstName = loser.firstName;
  if (!winner.lastName && loser.lastName) enrichPatch.lastName = loser.lastName;
  if (!winner.company && loser.company) enrichPatch.company = loser.company;
  if (!winner.companyDisplay && loser.companyDisplay) enrichPatch.companyDisplay = loser.companyDisplay;
  if (!winner.phone && loser.phone) enrichPatch.phone = loser.phone;
  if (!winner.linkedinUrl && loser.linkedinUrl) enrichPatch.linkedinUrl = loser.linkedinUrl;
  // Data-jsonb mergen (Winner-Keys gewinnen).
  const mergedData: Record<string, string> = { ...(loser.data ?? {}), ...(winner.data ?? {}) };
  enrichPatch.data = mergedData;

  await db.transaction(async (tx) => {
    // 1. Leads umhängen
    await tx.execute(sql`
      UPDATE ${leads} SET contact_id = ${input.winnerId}
       WHERE contact_id = ${input.loserId}
    `);

    // 2. List-Memberships umhängen (mit ON CONFLICT für bereits-drin-Fälle)
    await tx.execute(sql`
      INSERT INTO ${listMemberships} (list_id, contact_id, user_id, added_via, added_at)
      SELECT list_id, ${input.winnerId}, ${input.userId}, 'merge', now()
        FROM ${listMemberships}
       WHERE contact_id = ${input.loserId}
      ON CONFLICT (list_id, contact_id) DO NOTHING
    `);

    // 3. Winner mit angereicherten Feldern updaten
    await tx.update(contacts).set(enrichPatch).where(eq(contacts.id, input.winnerId));

    // 4. Loser soft-löschen (Hard-Delete würde leads.contact_id auf NULL
    // setzen, dann wären alle Leads orphan. Wir wollen sie am Winner haben,
    // deshalb erst UPDATE oben, dann Soft-Delete.)
    await tx
      .update(contacts)
      .set({
        deletedAt: new Date(),
        deletedReason: "merged_into:" + input.winnerId,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, input.loserId));
  });

  return true;
}

/**
 * Bulk-Import: legt neue Contacts an oder aktualisiert bestehende
 * (per Email-Match) und fügt sie optional zu einer Liste hinzu.
 *
 * `rows`: Array von bereits gemappten Contact-Objekten. E-Mails werden
 * lowercase/trim genormt. Duplikate (gleiche E-Mail beim gleichen User)
 * werden UPDATED (leere Felder mit Import-Werten befüllt), nicht doppelt
 * eingefügt.
 *
 * Returns Zähler für die UI: created (neu), updated (bestehend), skipped
 * (fehlerhafte Zeilen z.B. ohne minimale Identität), plus Liste der
 * Contact-IDs, damit der Caller sie in die List-Membership schieben kann.
 */
export async function bulkImportContacts(input: {
  userId: string;
  listId?: string | null;
  rows: Array<{
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    phone?: string | null;
    linkedinUrl?: string | null;
    data?: Record<string, string>;
  }>;
  registerCustomFields?: Array<{ key: string; label: string; detectedType: string }>;
}): Promise<{
  created: number;
  updated: number;
  skipped: number;
  contactIds: string[];
}> {
  const { userId, listId = null, rows, registerCustomFields = [] } = input;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const touchedIds: string[] = [];

  // Custom-Field-Definitionen upserten (usage_count += 1). Ignorierbar bei
  // Konflikt (schon vorhanden).
  if (registerCustomFields.length > 0) {
    for (const f of registerCustomFields) {
      await db.execute(sql`
        INSERT INTO contact_fields (user_id, key, label, detected_type, usage_count)
        VALUES (${userId}, ${f.key}, ${f.label}, ${f.detectedType}, 1)
        ON CONFLICT (user_id, key)
        DO UPDATE SET usage_count = contact_fields.usage_count + 1,
                      label = COALESCE(EXCLUDED.label, contact_fields.label),
                      updated_at = now()
      `);
    }
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const emailNorm = row.email ? row.email.trim().toLowerCase() : null;
      const hasIdentity =
        !!emailNorm ||
        !!(row.firstName || row.lastName) ||
        !!row.company;
      if (!hasIdentity) {
        skipped++;
        continue;
      }

      // Vorhandenen Contact per Email finden (falls Email da).
      let existingId: string | null = null;
      if (emailNorm) {
        const [existing] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.userId, userId),
              eq(contacts.email, emailNorm),
              isNull(contacts.deletedAt),
            ),
          )
          .limit(1);
        existingId = existing?.id ?? null;
      }

      if (existingId) {
        // Bestehenden Contact anreichern: nur leere Felder überschreiben,
        // data-jsonb mergen (Import-Werte gewinnen für Custom-Felder).
        await tx.execute(sql`
          UPDATE contacts
             SET first_name       = COALESCE(NULLIF(first_name,''), ${row.firstName ?? null}),
                 last_name        = COALESCE(NULLIF(last_name,''),  ${row.lastName ?? null}),
                 company          = COALESCE(NULLIF(company,''),    ${row.company ? row.company.toLowerCase() : null}),
                 company_display  = COALESCE(NULLIF(company_display,''), ${row.company ?? null}),
                 phone            = COALESCE(NULLIF(phone,''),      ${row.phone ?? null}),
                 linkedin_url     = COALESCE(NULLIF(linkedin_url,''), ${row.linkedinUrl ?? null}),
                 data             = COALESCE(data,'{}'::jsonb) || ${sql.raw(`'${JSON.stringify(row.data ?? {}).replace(/'/g, "''")}'::jsonb`)},
                 updated_at       = now()
           WHERE id = ${existingId}
        `);
        touchedIds.push(existingId);
        updated++;
      } else {
        const [ins] = await tx
          .insert(contacts)
          .values({
            userId,
            email: emailNorm,
            firstName: row.firstName ?? null,
            lastName: row.lastName ?? null,
            company: row.company ? row.company.toLowerCase() : null,
            companyDisplay: row.company ?? null,
            phone: row.phone ?? null,
            linkedinUrl: row.linkedinUrl ?? null,
            data: row.data ?? {},
          })
          .returning({ id: contacts.id });
        touchedIds.push(ins.id);
        created++;
      }
    }

    // Optional: alle Contacts zur Liste hinzufügen.
    if (listId && touchedIds.length > 0) {
      for (const cid of touchedIds) {
        await tx
          .insert(listMemberships)
          .values({ listId, contactId: cid, userId, addedVia: "import" })
          .onConflictDoNothing();
      }
    }
  });

  if (listId) await refreshContactCount(listId);

  return { created, updated, skipped, contactIds: touchedIds };
}

/** Custom-Feld-Definitionen des Users. */
export async function listContactFields(userId: string): Promise<
  Array<{
    id: string;
    key: string;
    label: string;
    detectedType: string;
    usageCount: number;
  }>
> {
  const rows = await db
    .select({
      id: contactFields.id,
      key: contactFields.key,
      label: contactFields.label,
      detectedType: contactFields.detectedType,
      usageCount: contactFields.usageCount,
    })
    .from(contactFields)
    .where(eq(contactFields.userId, userId))
    .orderBy(desc(contactFields.usageCount), contactFields.label);
  return rows;
}
