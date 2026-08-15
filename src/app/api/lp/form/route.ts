export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/lp/form  (Landingpage v3, Etappe 2, Konzept-Abschnitt 5.6)
 *
 * Öffentlicher Formular-CTA auf personalisierten Landingpages für
 * Empfänger ohne Buchungstool. Same-origin-Fetch von der öffentlichen
 * Lead-Landingpage (auch auf Custom-Domains) — deshalb KEIN Auth-Guard.
 *
 * Body JSON:
 *   { leadId, name, email, phone?, message?, website? }
 *
 * Verhalten:
 *   - `website` ist ein Honeypot: gefüllt → 200 {ok:true}, nichts passiert.
 *   - Validierungsfehler → 422 mit deutscher Fehlermeldung (Du-Form,
 *     ohne Reflection der Eingaben).
 *   - Rate-Limit: max. 5 form_submit-Events pro Lead pro Stunde
 *     (Count-Query auf lead_events, keine neue Infrastruktur) → 429.
 *   - Speicherung: lead_events kind='form_submit',
 *     payload {name, email, phone, message}.
 *   - Mail an den Besitzer-User (leads → runs → users). Mail-Fehler
 *     failen den Request NICHT — das Event ist dann trotzdem gespeichert.
 *
 * SICHERHEIT: Keine Logs mit vollständigen PII; Fehlermeldungen
 * reflektieren keine Nutzereingaben.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadEvents, leads, runs, users } from "@/lib/db/schema";
import { insertLeadEvent } from "@/lib/db/queries/lead-events";
import { parseLpFormSubmission } from "@/lib/lp-form";
import { sendLpFormSubmissionMail } from "@/lib/mail";
import { appBaseUrl } from "@/lib/landing-og";
import { getClientIp, getTrackingSecret, hashIp } from "@/lib/tracking";
import { formatPersonName, formatCompanyName } from "@/lib/format-name";

const RATE_LIMIT_MAX_PER_HOUR = 5;

/**
 * Defensiver Anzeigename des Leads aus `lead.data` — Leadlisten haben
 * keine garantierten Spaltennamen, deshalb Alias-Suche (case-insensitiv).
 */
function deriveLeadName(data: Record<string, string> | null): string | null {
  if (!data || typeof data !== "object") return null;
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") lower.set(k.toLowerCase(), v);
  }
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = lower.get(k);
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return null;
  };
  const first = pick(["vorname", "firstname", "first_name"]);
  const last = pick(["nachname", "lastname", "last_name", "name"]);
  const person = [first, last].filter(Boolean).join(" ").trim();
  if (person.length > 0) return formatPersonName(person);
  const company = pick(["firmenname", "firma", "company", "unternehmen"]);
  if (company) return formatCompanyName(company);
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Deine Anfrage konnte nicht verarbeitet werden. Bitte lade die Seite neu und versuche es noch einmal.",
      },
      { status: 422 },
    );
  }

  const parsed = parseLpFormSubmission(bodyRaw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 422 },
    );
  }
  // Honeypot gefüllt → Bot. Erfolg vortäuschen, aber NICHTS speichern/senden.
  if (parsed.honeypot) {
    return NextResponse.json({ ok: true });
  }
  const form = parsed.value;

  // Lead + Besitzer in einem Query auflösen (leads → runs → users).
  const [ctx] = await db
    .select({
      leadId: leads.id,
      leadData: leads.data,
      runId: leads.runId,
      campaignId: leads.campaignId,
      ownerEmail: users.email,
      ownerFirstName: users.firstName,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(users, eq(users.id, runs.userId))
    .where(eq(leads.id, form.leadId))
    .limit(1);

  if (!ctx) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Deine Anfrage konnte keinem Empfänger zugeordnet werden. Bitte lade die Seite neu und versuche es noch einmal.",
      },
      { status: 422 },
    );
  }

  // Rate-Limit ohne neue Infrastruktur: Count-Query auf lead_events.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [rate] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.leadId, form.leadId),
        eq(leadEvents.kind, "form_submit"),
        gte(leadEvents.ts, oneHourAgo),
      ),
    );
  if ((rate?.count ?? 0) >= RATE_LIMIT_MAX_PER_HOUR) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Du hast gerade schon mehrere Anfragen gesendet. Bitte warte einen Moment und versuche es später noch einmal.",
      },
      { status: 429 },
    );
  }

  // Event speichern (gleicher Pfad wie das übrige Lead-Tracking; schreibt
  // auch die denormalisierten Aggregate und feuert CRM-/Webhook-Hooks).
  await insertLeadEvent({
    leadId: form.leadId,
    kind: "form_submit",
    payload: {
      name: form.name,
      email: form.email,
      phone: form.phone,
      message: form.message,
    },
    ipHash: hashIp(getClientIp(req), getTrackingSecret()),
  });

  // Mail an den Besitzer — Fehler dürfen den Request nicht failen.
  try {
    await sendLpFormSubmissionMail({
      to: ctx.ownerEmail,
      firstName: ctx.ownerFirstName,
      leadName: deriveLeadName(ctx.leadData),
      form: {
        name: form.name,
        email: form.email,
        phone: form.phone,
        message: form.message,
      },
      contactUrl: `${appBaseUrl()}/kampagnen/${ctx.campaignId}/runs/${ctx.runId}`,
    });
  } catch (err) {
    // PII-Schutz: nur leadId + Fehlermeldung loggen, keine Formulardaten.
    console.error(
      `[lp/form] owner mail failed for lead=${form.leadId}:`,
      err instanceof Error ? err.message : "unknown",
    );
  }

  return NextResponse.json({ ok: true });
}
