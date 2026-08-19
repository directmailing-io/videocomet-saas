/**
 * POST /api/campaigns/:id/runs/from-list
 *
 * Erstellt eine Runde direkt aus einer bestehenden Kontakt-Liste. Skippt
 * CSV-Upload, Mapping und Duplikat-Wizard — die Contacts haben schon
 * Basis-Felder + data-jsonb.
 *
 * Body:
 *   { listId: uuid, name?: string, skipPreflight?: boolean }
 *
 * Response:
 *   { runId: uuid, leadCount: number }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, contactLists, contacts, leads, listMemberships, runs } from "@/lib/db/schema";
import { createRun } from "@/lib/db/queries/runs";
import { pipelineQueue } from "@/worker/queue";
import {
  countUserRenderBacklog,
  fairLeadPriority,
} from "@/lib/queue-fairness";
import {
  buildLeadDataFromContact,
  normalizeContactMapping,
  type ContactMapping,
} from "@/lib/contacts/mapping";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const listId = typeof b.listId === "string" ? b.listId : "";
  const runName =
    typeof b.name === "string" && b.name.trim()
      ? b.name.trim()
      : `Runde ${new Date().toLocaleDateString("de-DE")}`;
  // Optional: Placeholder-auf-Contact-Property-Mapping vom Wizard v4.
  // Ohne Mapping fallen wir auf das bisherige Basis-Feld-Copy zurück.
  const contactMapping: ContactMapping | null = b.contactMapping
    ? normalizeContactMapping(b.contactMapping)
    : null;
  // Optional: welche Contacts sollen übersprungen werden (skip-Liste
  // aus dem Duplikat-Detail-Screen). IDs beziehen sich auf contacts.id.
  const skipContactIds = new Set(
    Array.isArray(b.skipContactIds)
      ? b.skipContactIds.filter((v): v is string => typeof v === "string")
      : [],
  );

  if (!listId) {
    return NextResponse.json({ error: "Bitte wähl eine Liste aus." }, { status: 400 });
  }

  // Ownership: Kampagne + Liste gehören dem User.
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, params.id), eq(campaigns.userId, auth.user.id)))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "Diese Kampagne gibt es nicht mehr." }, { status: 404 });
  }
  const [list] = await db
    .select({ id: contactLists.id })
    .from(contactLists)
    .where(and(eq(contactLists.id, listId), eq(contactLists.userId, auth.user.id)))
    .limit(1);
  if (!list) {
    return NextResponse.json({ error: "Diese Liste gibt es nicht mehr." }, { status: 404 });
  }

  // Alle Kontakte der Liste holen — Smart-Listen werden hier NOCH nicht
  // ausgewertet, nur statische Memberships. (Smart-Listen als Runden-
  // Quelle kommt später, wenn Wert-Beleg gebraucht wird.)
  const memberContacts = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      company: contacts.company,
      companyDisplay: contacts.companyDisplay,
      phone: contacts.phone,
      linkedinUrl: contacts.linkedinUrl,
      salutation: contacts.salutation,
      title: contacts.title,
      externalId: contacts.externalId,
      street: contacts.street,
      postalCode: contacts.postalCode,
      city: contacts.city,
      country: contacts.country,
      position: contacts.position,
      website: contacts.website,
      gender: contacts.gender,
      data: contacts.data,
    })
    .from(listMemberships)
    .innerJoin(
      contacts,
      and(eq(contacts.id, listMemberships.contactId), isNull(contacts.deletedAt)),
    )
    .where(eq(listMemberships.listId, listId));

  // Skip-Liste aus dem Duplikat-Screen anwenden
  const effectiveContacts = skipContactIds.size > 0
    ? memberContacts.filter((c) => !skipContactIds.has(c.id))
    : memberContacts;

  if (effectiveContacts.length === 0) {
    return NextResponse.json(
      { error: skipContactIds.size > 0
          ? "Nach dem Überspringen bleibt kein Kontakt übrig."
          : "Die Liste ist leer. Bitte erst Kontakte hinzufügen." },
      { status: 400 },
    );
  }

  // Runde anlegen.
  const run = await createRun(auth.user.id, {
    campaignId: params.id,
    name: runName,
    status: "generating",
    startedAt: new Date(),
    totalLeads: effectiveContacts.length,
  });

  // Für jeden Contact einen Lead-Row anlegen. Wenn ein Placeholder-Mapping
  // mitgeliefert wurde (Wizard v4 Step 4), nutzen wir buildLeadDataFromContact
  // — sonst der bisherige Basis-Feld-Copy-Weg für Rückwärts-Kompat.
  const leadRows = effectiveContacts.map((c, i) => {
    let data: Record<string, string>;
    if (contactMapping && Object.keys(contactMapping).length > 0) {
      data = buildLeadDataFromContact(contactMapping, {
        contact: {
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          companyDisplay: c.companyDisplay,
          phone: c.phone,
          linkedinUrl: c.linkedinUrl,
          salutation: c.salutation,
          title: c.title,
          externalId: c.externalId,
          street: c.street,
          postalCode: c.postalCode,
          city: c.city,
          country: c.country,
          position: c.position,
          website: c.website,
          gender: c.gender,
          data: c.data ?? {},
        },
        system: {},
      });
    } else {
      const first = c.firstName ?? c.data?.firstName ?? "";
      const last = c.lastName ?? c.data?.lastName ?? "";
      const comp = c.companyDisplay ?? c.company;
      data = {
        ...(c.data ?? {}),
        ...(first ? { firstName: first } : {}),
        ...(last ? { lastName: last } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(comp ? { company: comp } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.linkedinUrl ? { linkedin: c.linkedinUrl } : {}),
      };
    }
    return {
      runId: run.id,
      campaignId: params.id,
      rowIndex: i,
      data,
      status: "pending" as const,
      contactId: c.id,
      preflightStatus: "pending",
    };
  });

  const inserted = await db
    .insert(leads)
    .values(leadRows)
    .returning({ id: leads.id, rowIndex: leads.rowIndex });

  // Pipeline-Jobs enqueuen.
  try {
    // User-Fairness (Phase 1): eigener offener Backlog anderer Runs
    // verschiebt die Priorität nach hinten.
    const userBacklog = await countUserRenderBacklog(auth.user.id, run.id);
    const queue = pipelineQueue();
    await queue.addBulk(
      inserted.map((l) => ({
        name: "lead-pipeline",
        data: {
          leadId: l.id,
          runId: run.id,
          userId: auth.user.id,
          campaignId: params.id,
        },
        opts: { jobId: l.id, priority: fairLeadPriority(l.rowIndex, userBacklog) },
      })),
    );
  } catch (err) {
    console.error("[from-list] enqueue failed:", err);
    return NextResponse.json(
      { error: "Runde angelegt, aber Jobs konnten nicht eingereiht werden.", runId: run.id },
      { status: 500 },
    );
  }

  return NextResponse.json({ runId: run.id, leadCount: inserted.length });
}
