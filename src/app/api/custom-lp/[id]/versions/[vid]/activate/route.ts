/**
 * Activate a version: set `customLpTemplates.activeVersionId = <vid>` so
 * future runs of campaigns referencing this template start with this
 * version. Optionally also REPINS the listed existing runs to the new
 * version (body field `repinRunIds` or query param `?repinRuns=…`).
 *
 * Semantics:
 *   - Activation alone does NOT affect runs that are already pinned.
 *     Pinned runs stay reproducible until explicitly repinned.
 *   - The repin list is OPTIONAL — passing `[]` (or omitting it) is the
 *     normal "only future runs" path.
 *
 *   POST /api/custom-lp/[id]/versions/[vid]/activate
 *     body: { repinRunIds?: string[] }
 *     query: ?repinRuns=runId1,runId2  (alternative, mostly for ergonomic UI links)
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  activateVersion,
  repinRuns,
} from "@/lib/db/queries/custom-lp";

const bodySchema = z
  .object({
    repinRunIds: z.array(z.string().uuid()).max(1_000).optional(),
  })
  .optional();

function readQueryRunIds(req: NextRequest): string[] {
  const raw = req.nextUrl.searchParams.get("repinRuns");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s));
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; vid: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema> = undefined;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const json = await req.json();
      body = bodySchema.parse(json);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  let template;
  try {
    template = await activateVersion(params.id, params.vid, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Merge body + query (body wins on overlap).
  const queryRuns = readQueryRunIds(req);
  const bodyRuns = body?.repinRunIds ?? [];
  const runIds = Array.from(new Set([...queryRuns, ...bodyRuns]));

  let repinnedCount = 0;
  if (runIds.length > 0) {
    repinnedCount = await repinRuns({
      userId: auth.user.id,
      versionId: params.vid,
      runIds,
    });
  }

  return NextResponse.json({
    template,
    activeVersionId: params.vid,
    repinnedRunCount: repinnedCount,
  });
}
