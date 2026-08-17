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

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contacts,
  contactLists,
  contactFields,
  leads,
  listMemberships,
  runs,
  campaigns,
  type ContactRow,
  type ContactListRow,
} from "@/lib/db/schema";

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
}): Promise<{ contacts: ContactRowUi[]; total: number }> {
  const {
    userId,
    listId = null,
    search,
    limit = 100,
    offset = 0,
    sort = "activity",
  } = input;

  const whereParts = [eq(contacts.userId, userId), isNull(contacts.deletedAt)];

  if (listId) {
    // Membership-Filter über EXISTS (kein JOIN → sauberer count).
    whereParts.push(
      sql`EXISTS (
        SELECT 1 FROM ${listMemberships} lm
        WHERE lm.contact_id = ${contacts.id} AND lm.list_id = ${listId}
      )`,
    );
  }
  if (search && search.length >= 2) {
    const term = `%${search.toLowerCase()}%`;
    whereParts.push(
      or(
        sql`LOWER(COALESCE(${contacts.email}, '')) LIKE ${term}`,
        sql`LOWER(COALESCE(${contacts.firstName} || ' ' || ${contacts.lastName}, '')) LIKE ${term}`,
        sql`LOWER(COALESCE(${contacts.companyDisplay}, ${contacts.company}, '')) LIKE ${term}`,
      )!,
    );
  }

  const whereExpr = and(...whereParts);

  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(whereExpr);
  const total = totalRows[0]?.n ?? 0;

  const orderBy =
    sort === "name"
      ? sql`COALESCE(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}) ASC`
      : sort === "recent"
        ? sql`${contacts.createdAt} DESC`
        : sql`${contacts.lastActivityAt} DESC NULLS LAST`;

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
