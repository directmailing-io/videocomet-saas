export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { reviveMessagesForLead } from "@/lib/db/queries/email-blasts";
import { checkEmailAddress } from "@/lib/email/address-check";

/**
 * PATCH /api/leads/[id]
 *
 * Edit Lead-Daten (JSONB `data`) nachtraeglich. Anwendungsfall: User
 * entdeckt Tippfehler (falscher Vorname, alte Adresse) in einem Lead
 * nachdem die Runde bereits gelaufen ist und moechte einzelne Zellen
 * korrigieren, ohne die komplette Runde neu anstossen zu muessen.
 *
 * Body:
 *   { data: Record<string,string> }   // ersetzt komplettes lead.data
 *   { name?: string, email?: string } // separate Top-Level-Spalten
 *
 * Guards:
 *   - Tenant-scope ueber runs.userId
 *   - Wenn die Runde gerade laeuft (run.status === "generating") und
 *     der Lead noch nicht abgeschlossen ist → 409, um Race-Condition
 *     mit dem Worker zu vermeiden (der die Daten schon eingelesen hat).
 *
 * Returns:
 *   { lead }  (aktualisiertes Lead-Objekt)
 */
const dataSchema = z.record(z.string(), z.string()).refine(
  (v) => Object.keys(v).length <= 200,
  { message: "Zu viele Felder (max 200)." },
);

const patchSchema = z
  .object({
    data: dataSchema.optional(),
  })
  .refine((v) => v.data !== undefined, {
    message: "Nichts zu aktualisieren.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      leadId: leads.id,
      leadStatus: leads.status,
      runStatus: runs.status,
      normalizedEmail: leads.normalizedEmail,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  // Waehrend die Pipeline aktiv laeuft: nur Leads editieren die schon
  // fertig sind (completed/failed). Andernfalls koennte der Worker die
  // Zwischen-Version einlesen und wieder ueberschreiben.
  if (
    row.runStatus === "generating" &&
    row.leadStatus !== "completed" &&
    row.leadStatus !== "failed"
  ) {
    return NextResponse.json(
      {
        error:
          "Lead wird gerade verarbeitet — bitte kurz warten oder den Lead danach editieren.",
      },
      { status: 409 },
    );
  }

  // `leads` hat KEIN updated_at column — nur pdf_expires_at etc. Wir
  // duerfen nur die Felder setzen die tatsaechlich existieren, sonst
  // scheitert die SQL-Query komplett.
  const patch: Record<string, unknown> = {};
  if (body.data !== undefined) patch.data = body.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ lead: null, noChange: true });
  }

  // row.leadId stammt aus der Ownership-gescopten Query oben — nicht aus
  // params, damit der User-Scope explizit im Datenfluss bleibt.
  const [updated] = await db
    .update(leads)
    .set(patch)
    .where(eq(leads.id, row.leadId))
    .returning();

  // Adress-Korrektur: hat sich die E-Mail geändert, wird sie sofort neu
  // geprüft und ggf. werden fehlgeschlagene/übersprungene Messages in
  // aktiven Blasts automatisch wieder in den Versand aufgenommen
  // (Suppression hängt an der alten Adresse, nicht am Lead).
  const oldEmail = (row.normalizedEmail ?? "").trim().toLowerCase();
  const newEmail = (updated?.normalizedEmail ?? "").trim().toLowerCase();
  let emailCheck: { status: string } | null = null;
  let revivedMessages = 0;
  if (newEmail && newEmail !== oldEmail) {
    emailCheck = await checkEmailAddress(newEmail);
    if (emailCheck.status === "ok" || emailCheck.status === "unknown") {
      revivedMessages = await reviveMessagesForLead(
        auth.user.id,
        row.leadId,
        newEmail,
      );
    }
  }

  return NextResponse.json({ lead: updated, emailCheck, revivedMessages });
}
