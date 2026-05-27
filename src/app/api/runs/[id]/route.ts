export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  deleteRun,
  getRun,
  updateRun,
} from "@/lib/db/queries/runs";
import { countByStatus } from "@/lib/db/queries/leads";
import { deleteVideo } from "@/lib/bunny/stream";
import { deleteFile } from "@/lib/bunny/storage";

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
 * DELETE /api/runs/[id] — cascades Leads (DB foreign key) and best-effort
 * cleans up Bunny assets in the background. Bunny errors are swallowed so a
 * single failed remote delete doesn't block the run-delete.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    // Verify ownership first.
    await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Snapshot lead-assets before deleting the run so we can clean Bunny up.
  const leadAssets = await db
    .select({
      bunnyVideoId: leads.bunnyVideoId,
      pdfUrl: leads.pdfUrl,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, params.id), eq(runs.userId, auth.user.id)));

  await deleteRun(params.id, auth.user.id);

  // Best-effort Bunny cleanup, fire-and-forget so the response stays fast.
  void cleanupBunnyAssets(leadAssets);

  return NextResponse.json({ ok: true });
}

async function cleanupBunnyAssets(
  assets: Array<{ bunnyVideoId: string | null; pdfUrl: string | null }>,
): Promise<void> {
  for (const a of assets) {
    if (a.bunnyVideoId) {
      try {
        await deleteVideo(a.bunnyVideoId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[runs:delete] bunny video delete failed:", err);
      }
    }
    if (a.pdfUrl) {
      // pdfUrl typically encodes a CDN host plus a remote-path. We can only
      // delete via the remote-path; storing it separately would be cleaner,
      // but for v1 we attempt to derive `runs/<runId>/leads/<leadId>.pdf`
      // from the URL's path.
      const remote = derivePdfRemotePath(a.pdfUrl);
      if (remote) {
        try {
          await deleteFile(remote);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[runs:delete] bunny pdf delete failed:", err);
        }
      }
    }
  }
}

function derivePdfRemotePath(url: string): string | null {
  try {
    const u = new URL(url);
    // Drop leading slash.
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return null;
  }
}
