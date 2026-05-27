export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";

interface StoredColumnMapping {
  mapping?: Record<string, string>;
  parsed?: unknown;
}

const putSchema = z.object({
  columnMapping: z.record(z.string(), z.string()),
});

/**
 * PUT /api/runs/[id]/mapping
 *
 * Stores the placeholder→column mapping while keeping the parsed-rows blob
 * intact. Body: { columnMapping: { firstName: "Vorname", ... } }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungueltige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const [existingRow] = await db
    .select({ cm: runs.columnMapping })
    .from(runs)
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);
  const existing = (existingRow?.cm as StoredColumnMapping | null) ?? {};

  const next: StoredColumnMapping = {
    ...existing,
    mapping: body.columnMapping,
  };

  await db
    .update(runs)
    .set({
      columnMapping: next as unknown as Record<string, string>,
      status: "mapping",
    })
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

  return NextResponse.json({ ok: true });
}
