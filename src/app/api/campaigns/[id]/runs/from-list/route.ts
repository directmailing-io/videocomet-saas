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
import { leadJobPriority } from "@/lib/queue-priority";

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

  if (!listId) {
    return NextResponse.json({ error: "listId erwartet." }, { status: 400 });
  }

  // Ownership: Kampagne + Liste gehören dem User.
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, params.id), eq(campaigns.userId, auth.user.id)))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "Kampagne nicht gefunden." }, { status: 404 });
  }
  const [list] = await db
    .select({ id: contactLists.id })
    .from(contactLists)
    .where(and(eq(contactLists.id, listId), eq(contactLists.userId, auth.user.id)))
    .limit(1);
  if (!list) {
    return NextResponse.json({ error: "Liste nicht gefunden." }, { status: 404 });
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
      company: contacts.companyDisplay,
      phone: contacts.phone,
      linkedinUrl: contacts.linkedinUrl,
      data: contacts.data,
    })
    .from(listMemberships)
    .innerJoin(
      contacts,
      and(eq(contacts.id, listMemberships.contactId), isNull(contacts.deletedAt)),
    )
    .where(eq(listMemberships.listId, listId));

  if (memberContacts.length === 0) {
    return NextResponse.json(
      { error: "Die Liste ist leer." },
      { status: 400 },
    );
  }

  // Runde anlegen. sourceType existiert im Schema als "csv"|"xlsx"|
  // "google-sheets"; für "aus Liste" gibt es (noch) keinen eigenen Typ,
  // deshalb nur den Namen prägnant benennen und sourceType null lassen.
  const run = await createRun(auth.user.id, {
    campaignId: params.id,
    name: runName,
    status: "generating",
    startedAt: new Date(),
    totalLeads: memberContacts.length,
  });

  // Für jeden Contact einen Lead-Row anlegen.
  const leadRows = memberContacts.map((c, i) => {
    const first = c.firstName ?? c.data?.firstName ?? "";
    const last = c.lastName ?? c.data?.lastName ?? "";
    const data: Record<string, string> = {
      ...(c.data ?? {}),
      ...(first ? { firstName: first } : {}),
      ...(last ? { lastName: last } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.company ? { company: c.company } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      ...(c.linkedinUrl ? { linkedin: c.linkedinUrl } : {}),
    };
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
        opts: { jobId: l.id, priority: leadJobPriority(l.rowIndex) },
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
