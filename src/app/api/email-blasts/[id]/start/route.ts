export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { InsufficientCreditsError } from "@/lib/billing/credit-service";
import { serializeEmailBlast, startEmailBlast } from "@/lib/db/queries/email-blasts";
import { emailGifJobId, emailGifQueue } from "@/worker/email-gif-queue";

const PostBody = z.object({
  /** Volltext der bestätigten Checkboxen — wird im confirmationLog protokolliert. */
  confirmationTextVersion: z.string().min(10).max(5_000),
});

/**
 * POST /api/email-blasts/[id]/start — Draft ⇒ running in EINER Transaktion
 * (Confirmation-Log, Snapshot, Empfänger-Materialisierung, Credit-Charge).
 * Danach GIF-Encodes für Leads ohne aktuellen Hash enqueuen.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bestätigung fehlt — bitte beide Checkboxen bestätigen." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await startEmailBlast({
      blastId: params.id,
      userId: auth.user.id,
      confirmationTextVersion: parsed.data.confirmationTextVersion,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: `Nicht genug Credits: benötigt ${err.required}, verfügbar ${err.available}.`,
          errorKind: "insufficient_credits",
          required: err.required,
          available: err.available,
        },
        { status: 402 },
      );
    }
    throw err;
  }

  if (!result.ok) {
    const map: Record<string, { status: number; message: string }> = {
      not_found: { status: 404, message: "Nicht gefunden." },
      wrong_status: {
        status: 409,
        message: "Der Blast wurde bereits gestartet.",
      },
      mailbox_unavailable: {
        status: 400,
        message: "Das Postfach ist nicht verbunden. Bitte erst neu verbinden.",
      },
      template_incomplete: {
        status: 400,
        message: "Die Vorlage ist unvollständig (Betreff und Text sind Pflicht; Impressum bei kompletter Signatur).",
      },
      no_recipients: {
        status: 400,
        message: "Keine versandfähigen Empfänger gefunden.",
      },
    };
    const m = map[result.error] ?? { status: 400, message: "Start nicht möglich." };
    return NextResponse.json({ error: m.message }, { status: m.status });
  }

  if (result.gifLeads.length > 0) {
    const queue = emailGifQueue();
    // Stale Job-IDs entfernen — BullMQ dedupt sonst still gegen
    // completed/failed-ZSETs (Muster email-gif-Route).
    await Promise.all(
      result.gifLeads.map((l) =>
        queue.remove(emailGifJobId(l.leadId)).catch(() => undefined),
      ),
    );
    await queue.addBulk(
      result.gifLeads.map((l) => ({
        name: "email-gif",
        data: {
          leadId: l.leadId,
          campaignId: l.campaignId,
          userId: auth.user.id,
        },
        opts: { jobId: emailGifJobId(l.leadId) },
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    blast: serializeEmailBlast(result.blast),
    scheduled: result.scheduled,
    skipped: result.skipped,
    creditsCharged: result.creditsCharged,
    gifJobsEnqueued: result.gifLeads.length,
  });
}
