export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Queue, type ConnectionOptions } from "bullmq";
import { requireUserApi } from "@/lib/auth-guard";
import { getRedisConnection } from "@/worker/queue";
import { resetLeadForPreflightRetry } from "@/lib/db/queries/leads";
import { getRunForPreflight } from "@/lib/db/queries/runs";

const BodySchema = z.object({
  leadId: z.string().uuid(),
});

// Identisch zum Start-Endpoint — siehe Begründung dort.
const LEAD_PREFLIGHT_QUEUE = "lead-preflight";

interface PreflightJobData {
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
}

let _q: Queue<PreflightJobData> | null = null;
function preflightQueue(): Queue<PreflightJobData> {
  if (_q) return _q;
  _q = new Queue<PreflightJobData>(LEAD_PREFLIGHT_QUEUE, {
    connection: getRedisConnection() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _q;
}

/**
 * POST /api/runs/[id]/preflight/retry-screenshot
 *
 * Stellt den Preflight-Job für einen einzelnen Lead erneut in die Queue.
 * Vorgehen:
 *   1. Reset des DB-Status auf 'pending', attempts++, error_message = null.
 *   2. Vorhandenen Job mit der jobId (= leadId) aus der Queue entfernen
 *      (kann bei Erfolg-Dedup-Bug noch dort sein). Failure dort ist
 *      uncritical → catch-and-continue.
 *   3. Bulk-Add eines neuen Jobs mit derselben jobId.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body muss JSON sein.", details: null },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Anfrage.", details: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const { leadId } = parsed.data;

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  const reset = await resetLeadForPreflightRetry(
    leadId,
    params.id,
    auth.user.id,
  );
  if (!reset) {
    return NextResponse.json(
      { error: "Lead nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  try {
    const queue = preflightQueue();
    // Step 1: existierenden Job entfernen (Dedup-Workaround). Wenn der Job
    // nicht mehr in der Queue ist, wirft BullMQ — daher der bewusste Catch.
    await queue.remove(leadId).catch(() => undefined);
    await queue.add(
      "lead-preflight",
      {
        leadId,
        runId: params.id,
        userId: auth.user.id,
        campaignId: run.campaignId,
      },
      { jobId: leadId },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[preflight:retry-screenshot] enqueue failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: "Job-Queue nicht erreichbar.",
        details: e instanceof Error ? e.message : null,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
