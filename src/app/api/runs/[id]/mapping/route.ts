export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import { collectCampaignPlaceholders } from "@/lib/placeholders/collector";
import { toLegacyMapping } from "@/lib/placeholders/substitute";
import type {
  PlaceholderMapping,
  StoredRunColumnMapping,
} from "@/lib/placeholders/types";

/**
 * Validierung:
 *   - Body kann das ALTE Format `{ columnMapping: Record<string,string> }`
 *     enthalten (für Backward-Compat mit dem alten Wizard-Step), oder das
 *     NEUE Format `{ placeholderMapping: Record<string, {column?,fallback?}> }`.
 *   - Wir akzeptieren BEIDE Felder gleichzeitig — `placeholderMapping`
 *     gewinnt, das alte `columnMapping` wird (sofern vorhanden) in den
 *     gespeicherten `mapping`-Slot übernommen.
 */
const entrySchema = z.object({
  column: z.string().min(1).max(200).optional(),
  fallback: z.string().max(500).optional(),
});

const putSchema = z
  .object({
    /** Altes Format (Backward-Compat). */
    columnMapping: z.record(z.string(), z.string()).optional(),
    /** Neues Format mit Many-to-one + Fallback. */
    placeholderMapping: z.record(z.string(), entrySchema).optional(),
  })
  .refine(
    (v) => v.columnMapping !== undefined || v.placeholderMapping !== undefined,
    {
      message: "Entweder columnMapping ODER placeholderMapping ist Pflicht.",
    },
  );

/**
 * PUT /api/runs/[id]/mapping
 *
 * Speichert das Mapping in `runs.column_mapping`. Format-Strategie:
 *   - `parsed`              bleibt unverändert (CSV-Rows liegen weiter dort).
 *   - `mapping` (legacy)    wird aus `placeholderMapping` abgeleitet, sodass
 *                           der `start`-Endpoint (der noch `mapping` liest)
 *                           kompatibel bleibt.
 *   - `placeholderMapping`  ist die neue Wahrheit. Wenn keine Keys gesetzt
 *                           sind, wird das Feld GELÖSCHT (sauberer JSON-Blob).
 *
 * Validation:
 *   - Keys im `placeholderMapping` müssen entweder vom Collector gefunden
 *     worden sein ODER im Slug-Template-Teil stehen (was der Collector als
 *     `kind: "slug"`-Source meldet — also auch dort gilt: Collector muss
 *     den Key kennen). Unknown-Key → 400.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
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
  const existing = (existingRow?.cm as StoredRunColumnMapping | null) ?? {};

  // Build effective placeholderMapping aus Body
  let effective: PlaceholderMapping = {};
  if (body.placeholderMapping) {
    effective = body.placeholderMapping as PlaceholderMapping;
  } else if (body.columnMapping) {
    // Backward-Compat: alter Body in das neue Format heben
    for (const [k, v] of Object.entries(body.columnMapping)) {
      if (typeof v === "string" && v.length > 0) {
        effective[k] = { column: v };
      }
    }
  }

  // Unknown-Key-Validation: nur wenn das neue Format gepostet wurde —
  // das alte Format kommt vom alten Wizard und darf nicht plötzlich
  // strenger werden. Wir validieren best-effort: bei Collector-Failure
  // (z. B. DB-Hickup) lassen wir das Mapping trotzdem durch.
  if (body.placeholderMapping) {
    try {
      const detected = await collectCampaignPlaceholders(
        run.campaignId,
        auth.user.id,
        { envelopeTemplateId: run.envelopeTemplateId ?? null },
      );
      const allowed = new Set(detected.map((p) => p.key));
      const unknown = Object.keys(effective).filter((k) => !allowed.has(k));
      if (unknown.length > 0) {
        return NextResponse.json(
          {
            error: "Mapping enthält unbekannte Platzhalter.",
            unknownKeys: unknown,
          },
          { status: 400 },
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[runs:mapping] collector failed during validation, accepting body:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Legacy-Mapping aus dem Effective ableiten (Worker-Kompat).
  const legacyMapping = toLegacyMapping(effective);

  const next: StoredRunColumnMapping = {
    parsed: existing.parsed,
    mapping: legacyMapping,
    placeholderMapping:
      Object.keys(effective).length > 0 ? effective : undefined,
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
