export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import type { DedupeConfig } from "@/lib/dedupe/types";

/**
 * PUT /api/runs/[id]/dedupe-config
 *
 * Persistiert die User-konfigurierte `DedupeConfig` (Paket A-Format) in
 * `runs.dedupe_config`. Wird vom Wizard beim Wechsel von Step 1 → Step 2
 * aufgerufen, sobald die Live-Compute-Card stabil ist. Tenant-Guard über
 * `getRun(id, userId)` (wirft bei foreign-run → 404).
 *
 * Validierung bewusst lax (nur Struktur-Check): die Engine ignoriert
 * fremde Felder im JSON und der CSV-Header-Set kann zwischen Aufrufen
 * variieren — strenge Spalten-Existenz-Validierung würde Race-Risiken
 * gegen den parallelen Upload-Step erzeugen.
 */
const normalizerSchema = z.enum([
  "default",
  "digits-only",
  "email",
  "url-host",
]);

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120).optional(),
  columns: z.array(z.string().min(1).max(200)).min(1).max(8),
  normalizers: z.record(z.string(), normalizerSchema).optional(),
  enabled: z.boolean(),
});

const dedupeConfigSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(["keep-first", "keep-all"]),
  rules: z.array(ruleSchema).max(20),
});

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

  let body: DedupeConfig;
  try {
    body = dedupeConfigSchema.parse(await req.json()) as DedupeConfig;
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Dedupe-Konfiguration.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  await db
    .update(runs)
    .set({
      // Schema-Typ ist bewusst `Record<string, unknown>` (TODO Paket A am
      // Schema-Anker): wir cast'en hier auf die Schema-Form. Sobald Paket A
      // die Schema-Typdefinition durch das echte `DedupeConfig` ersetzt,
      // fällt der Cast weg.
      dedupeConfig: body as unknown as Record<string, unknown>,
    })
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

  return NextResponse.json({ ok: true });
}
