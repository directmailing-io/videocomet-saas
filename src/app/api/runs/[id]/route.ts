export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  getRun,
  softDeleteRun,
  updateRun,
} from "@/lib/db/queries/runs";
import { countByStatus } from "@/lib/db/queries/leads";
import { removeBunnyAssetRefsForOwner } from "@/lib/db/queries/bunny-assets";
import { triggerBunnyPurgeTick } from "@/lib/bunny/purge-trigger";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z
    .enum(["draft", "mapping", "generating", "completed", "failed", "cancelled"])
    .optional(),
});

/**
 * GET /api/runs/[id] — returns the run + per-status lead counts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const run = await getRun(params.id, auth.user.id);
    const counts = await countByStatus(params.id, auth.user.id);
    return NextResponse.json({ run, counts });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * PATCH /api/runs/[id] — update name or transition status (e.g. cancel).
 */
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

  try {
    const run = await updateRun(params.id, auth.user.id, body);
    return NextResponse.json({ run });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * DELETE /api/runs/[id] — Soft-Delete + Bunny-Cleanup-Cascade.
 *
 * Ablöse für den alten inline Lead-für-Lead Bunny-Delete (zog Stream-API
 * synchron im Request-Pfad, ignorierte Shared-Video-Refs zwischen Leads).
 * Neuer Flow:
 *  1. Lead-IDs vor dem Soft-Delete snapshot'en (Tenant-Guard über Run-Join).
 *  2. `softDeleteRun` setzt `deletedAt` — der Run ist sofort aus dem UI.
 *  3. `bunny_asset_refs` für jeden Lead-Owner sowie den Run-Owner (Shared-
 *     Video-Ref) entfernen. Refs für Assets, die NOCH von anderen Runs/Leads
 *     verwendet werden (z.B. Shared-Webcam zwischen Runs), bleiben am
 *     Asset hängen und schützen die GUID vor dem Purge.
 *  4. Trigger einen sofortigen Purge-Tick; Cron alle 60s ist Fallback.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let leadIds: string[];
  try {
    // Verify ownership first.
    await getRun(params.id, auth.user.id);
    // Snapshot Lead-IDs scoped auf den Run und (via Join) auf den User.
    const leadRows = await db
      .select({ id: leads.id })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(and(eq(leads.runId, params.id), eq(runs.userId, auth.user.id)));
    leadIds = leadRows.map((l) => l.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  try {
    await softDeleteRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  try {
    await Promise.all([
      ...leadIds.map((id) => removeBunnyAssetRefsForOwner("lead", id)),
      // `run`-Owner deckt sharedBunnyVideoId der Webcam-only-Optimierung
      // ab. Refs werden vom Worker-Cron sowieso nachsweep'ed, aber das
      // direkte Remove hier macht den Purge-Trigger unten effektiv.
      removeBunnyAssetRefsForOwner("run", params.id),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[runs:delete] ref cleanup partial failure:", err);
  }

  void triggerBunnyPurgeTick("runs:delete");

  return NextResponse.json({ ok: true });
}
