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
import { enqueueForPreflight } from "@/lib/preflight/job-enqueue";
import {
  assignLabelToContacts,
  getOrCreateContactLabel,
} from "@/lib/db/queries/contact-labels";
import {
  countUserRenderBacklog,
  fairLeadPriority,
} from "@/lib/queue-fairness";
import {
  buildLeadDataFromContact,
  normalizeContactMapping,
  type ContactMapping,
} from "@/lib/contacts/mapping";
import { checkRunReadiness } from "@/lib/run-readiness";
import { allocateAbVariantsForRun } from "@/lib/run-ab-allocation";
import {
  assertBillingReadyForRun,
  BillingGateError,
} from "@/lib/billing/run-gate";

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
  // Runden-Override: Umschlag-Vorlage aus dem Wizard-Step-3. Ohne diese
  // Zeile landete die Auswahl nie im Run und die Pipeline generierte
  // keinen Umschlag, obwohl der User es angehakt hatte (Vorfall 2026-08-20).
  const envelopeTemplateId =
    typeof b.envelopeTemplateId === "string" && b.envelopeTemplateId
      ? b.envelopeTemplateId
      : null;
  // Optional: Auto-Label aus dem Wizard-Step-5 ("Versand 28.08.2026").
  // Wird nach dem Lead-Insert an alle Kontakte dieser Runde vergeben.
  const autoLabel =
    typeof b.autoLabel === "string" && b.autoLabel.trim()
      ? b.autoLabel.trim()
      : null;

  if (!listId) {
    return NextResponse.json({ error: "Bitte wähl eine Liste aus." }, { status: 400 });
  }

  // Ownership: Kampagne + Liste gehören dem User. Config-Felder gleich
  // mitladen — Readiness-Gate + A/B-Zuteilung brauchen sie (2026-08-21).
  const [campaign] = await db
    .select({
      id: campaigns.id,
      introEnabled: campaigns.introEnabled,
      abTestingEnabled: campaigns.abTestingEnabled,
      pdfEnabled: campaigns.pdfEnabled,
      pdfGoogleDocsUrl: campaigns.pdfGoogleDocsUrl,
      pdfGoogleDocsUrlB: campaigns.pdfGoogleDocsUrlB,
      abSplitMode: campaigns.abSplitMode,
      abSplitWeightA: campaigns.abSplitWeightA,
    })
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

  // ── READINESS-GATE (Reliability 2026-08-21) ─────────────────────────────
  // Dieser Pfad startete bisher OHNE jede Vorab-Prüfung direkt in die
  // Produktion — Vorfall 2026-08-21: Intro-Kampagne mit fehlgeschlagener
  // Kalibrierung lief still komplett ohne KI-Begrüßung durch. Jetzt läuft
  // hier dasselbe zentrale Gate wie im /start-Pfad. requireIntroReady=true,
  // weil es hier keine Review-Seite mit „ohne KI-Begrüßung"-Opt-out gibt.
  const readiness = await checkRunReadiness({
    userId: auth.user.id,
    campaignId: params.id,
    envelopeTemplateIdOverride: envelopeTemplateId,
    requireIntroReady: true,
  });
  if (!readiness.ok) {
    return NextResponse.json(
      {
        error: readiness.blockers.map((b) => b.message).join(" "),
        errorKind: "run_not_ready",
        blockers: readiness.blockers,
      },
      { status: 422 },
    );
  }

  // ── BILLING-GATE (Reliability 2026-08-21) ───────────────────────────────
  // Gleiche Prüfung wie im /start-Pfad: aktive Subscription + genug
  // Credits, BEVOR Leads angelegt werden. Vorher konnte dieser Pfad
  // Runden ohne Guthaben starten (der Charge-Fehler in der Pipeline wird
  // bewusst geschluckt → faktisch kostenlose Videos).
  const pricePerVideo = readiness.introEnabled ? 2 : 1;
  try {
    await assertBillingReadyForRun({
      userId: auth.user.id,
      plannedLeadCount: effectiveContacts.length,
      pricePerVideo,
    });
  } catch (err) {
    if (err instanceof BillingGateError) {
      return NextResponse.json(
        {
          error: err.message,
          errorKind: err.kind,
          ...(err.details ? { details: err.details } : {}),
        },
        { status: 402 },
      );
    }
    throw err;
  }

  // Runde anlegen. introExpected: Das Readiness-Gate oben garantiert, dass
  // bei aktivierter KI-Begrüßung Stimme + Kalibrierung bereit sind — die
  // Runde erwartet die Begrüßung damit verbindlich (Migration 0064).
  const run = await createRun(auth.user.id, {
    campaignId: params.id,
    name: runName,
    status: "generating",
    startedAt: new Date(),
    totalLeads: effectiveContacts.length,
    envelopeTemplateId,
    introExpected: readiness.introEnabled,
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

  // Auto-Label vergeben (nie fatal für die Runde).
  if (autoLabel) {
    try {
      const label = await getOrCreateContactLabel({
        userId: auth.user.id,
        name: autoLabel,
      });
      await assignLabelToContacts({
        userId: auth.user.id,
        labelId: label.id,
        contactIds: effectiveContacts.map((c) => c.id),
      });
    } catch (err) {
      console.warn("[from-list] auto-label failed:", err);
    }
  }

  // ── A/B-Zuteilung (Reliability 2026-08-21) ─────────────────────────────
  // MUSS vor dem Enqueue laufen: die Pipeline liest runs.abConfig +
  // leads.abVariant zur Laufzeit. Vorher bekamen from-list-Runden nie eine
  // Zuteilung — alle Leads liefen still mit Brief-Variante A, ohne in der
  // A/B-Statistik zu zählen.
  await allocateAbVariantsForRun({
    runId: run.id,
    campaign: {
      abTestingEnabled: campaign.abTestingEnabled,
      pdfEnabled: campaign.pdfEnabled,
      pdfGoogleDocsUrl: campaign.pdfGoogleDocsUrl,
      pdfGoogleDocsUrlB: campaign.pdfGoogleDocsUrlB,
      abSplitMode: campaign.abSplitMode,
      abSplitWeightA: campaign.abSplitWeightA,
    },
  });

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

  // Preflight-Info parallel nachziehen: das Rendering läuft weiter über
  // den bulk-add oben (unverändertes Verhalten), aber der Preflight-Worker
  // schreibt zusätzlich `preflight_status` + `preflight_final_url` in die DB,
  // damit die UI bei kaputten URLs Warnungen zeigen kann (Vorfall
  // 2026-08-19: alle Leads dieser Route blieben auf pending). Fehler hier
  // sind nie fatal für die Runde — die Videos werden trotzdem gerendert.
  const skipPreflight = b.skipPreflight === true;
  if (!skipPreflight) {
    void enqueueForPreflight(run.id, auth.user.id, params.id).catch((err) => {
      console.warn("[from-list] preflight side-enqueue failed:", err);
    });
  }

  return NextResponse.json({ runId: run.id, leadCount: inserted.length });
}
