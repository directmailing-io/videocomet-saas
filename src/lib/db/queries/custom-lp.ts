/**
 * CRUD helpers for the Custom-Landingpage feature.
 *
 * Style note: like the other `queries/*.ts` files, these throw `Error("Not
 * found")` on tenant-guard mismatches. API routes translate that into a
 * 404 to avoid leaking the existence of resources across users.
 */

import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  customLpTemplates,
  customLpVersions,
  runs,
} from "@/lib/db/schema";
import type { AffectedRunSummary } from "@/lib/custom-lp/types";

export type CustomLpTemplate = typeof customLpTemplates.$inferSelect;
export type NewCustomLpTemplate = typeof customLpTemplates.$inferInsert;

export type CustomLpVersion = typeof customLpVersions.$inferSelect;
export type NewCustomLpVersion = typeof customLpVersions.$inferInsert;

// ── Templates ───────────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  name: string;
  description?: string | null;
}

export async function createTemplate(
  userId: string,
  input: CreateTemplateInput,
): Promise<CustomLpTemplate> {
  const [row] = await db
    .insert(customLpTemplates)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create custom-lp template");
  return row;
}

export async function getTemplate(
  id: string,
  userId: string,
): Promise<CustomLpTemplate> {
  const [row] = await db
    .select()
    .from(customLpTemplates)
    .where(
      and(eq(customLpTemplates.id, id), eq(customLpTemplates.userId, userId)),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export interface UpdateTemplatePatch {
  name?: string;
  description?: string | null;
  activeVersionId?: string | null;
  thumbnailUrl?: string | null;
}

export async function updateTemplate(
  id: string,
  userId: string,
  patch: UpdateTemplatePatch,
): Promise<CustomLpTemplate> {
  const [row] = await db
    .update(customLpTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(customLpTemplates.id, id), eq(customLpTemplates.userId, userId)),
    )
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Deletes a template (cascade-deletes all versions via FK). Refuses if any
 * run is still pinning a version of this template — the API caller should
 * detach those runs first or surface the conflict to the user.
 *
 * NOTE: das `stillPinned`-Set ignoriert soft-gelöschte Versions NICHT —
 * eine gepinnte deleted-Version blockt den Template-Delete genauso wie eine
 * aktive, weil ein FK-Cascade die Run-Spalte sonst zerschlüge.
 */
export async function deleteTemplate(id: string, userId: string): Promise<void> {
  // Tenant-guard first.
  await getTemplate(id, userId);

  const stillPinned = await db
    .select({ runId: runs.id })
    .from(runs)
    .innerJoin(customLpVersions, eq(runs.customLpVersionId, customLpVersions.id))
    .where(eq(customLpVersions.templateId, id))
    .limit(1);

  if (stillPinned.length > 0) {
    const err = new Error("CustomLpTemplate is still referenced by runs");
    (err as Error & { code?: string }).code = "TEMPLATE_IN_USE";
    throw err;
  }

  // Detach campaigns referencing this template (SET NULL is handled by FK
  // but we do it explicitly here to avoid relying on cascade for non-FK
  // fields like `customLpTemplateId` if a future migration changes it).
  await db
    .update(campaigns)
    .set({ customLpTemplateId: null, updatedAt: new Date() })
    .where(eq(campaigns.customLpTemplateId, id));

  await db
    .delete(customLpTemplates)
    .where(
      and(eq(customLpTemplates.id, id), eq(customLpTemplates.userId, userId)),
    );
}

/** List + per-template version count + active-version summary, for the UI. */
export interface TemplateListRow {
  template: CustomLpTemplate;
  versionCount: number;
  activeVersion: {
    id: string;
    version: number;
    uploadedAt: Date;
  } | null;
}

export async function listTemplatesForUser(
  userId: string,
): Promise<TemplateListRow[]> {
  const rows = await db
    .select({
      template: customLpTemplates,
      versionCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${customLpVersions}
        WHERE ${customLpVersions.templateId} = ${customLpTemplates.id}
          AND ${customLpVersions.deletedAt} IS NULL
      )`,
      activeVersionId: customLpVersions.id,
      activeVersionNumber: customLpVersions.version,
      activeVersionUploadedAt: customLpVersions.uploadedAt,
    })
    .from(customLpTemplates)
    .leftJoin(
      customLpVersions,
      // Editor-Anzeige: aktive Version nur dann zurückgeben, wenn sie
      // nicht weichgelöscht ist. Auf Render-Seite (custom-lp-public.ts)
      // wird der Pin trotzdem aufgelöst, damit Bestand-Runs nicht brechen.
      and(
        eq(customLpTemplates.activeVersionId, customLpVersions.id),
        isNull(customLpVersions.deletedAt),
      ),
    )
    .where(eq(customLpTemplates.userId, userId))
    .orderBy(desc(customLpTemplates.createdAt));

  return rows.map((r) => ({
    template: r.template,
    versionCount: r.versionCount ?? 0,
    activeVersion:
      r.activeVersionId !== null && r.activeVersionNumber !== null && r.activeVersionUploadedAt !== null
        ? {
            id: r.activeVersionId,
            version: r.activeVersionNumber,
            uploadedAt: r.activeVersionUploadedAt,
          }
        : null,
  }));
}

// ── Versions ────────────────────────────────────────────────────────────────

export interface CreateVersionInput {
  templateId: string;
  storagePath: string;
  entryHtml: string;
  manifest: Record<string, unknown> | null;
  fileManifest: Array<{ path: string; size: number; hash: string; mime: string }>;
  annotations: Record<string, unknown> | null;
  bytesTotal: number;
}

/**
 * Inserts a new version row. The next `version` number is computed in a
 * single statement so concurrent uploads can't both grab `v3`.
 * (We rely on the `tpl_ver_uq` unique constraint as a hard fence; the
 *  subquery is best-effort.)
 */
export async function createVersion(
  input: CreateVersionInput,
): Promise<CustomLpVersion> {
  const result = await db.execute<typeof customLpVersions.$inferSelect>(sql`
    INSERT INTO ${customLpVersions} (
      template_id, version, storage_path, entry_html, manifest,
      file_manifest, annotations, bytes_total, uploaded_at
    )
    VALUES (
      ${input.templateId},
      COALESCE(
        (SELECT MAX(version) FROM ${customLpVersions}
         WHERE template_id = ${input.templateId}),
        0
      ) + 1,
      ${input.storagePath},
      ${input.entryHtml},
      ${input.manifest === null ? null : JSON.stringify(input.manifest)}::jsonb,
      ${JSON.stringify(input.fileManifest)}::jsonb,
      ${input.annotations === null ? null : JSON.stringify(input.annotations)}::jsonb,
      ${input.bytesTotal},
      now()
    )
    RETURNING *
  `);

  // postgres-js returns { rows, … } when using `db.execute`; normalise.
  const rows = (result as unknown as { rows?: CustomLpVersion[] }).rows
    ?? (result as unknown as CustomLpVersion[]);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) throw new Error("Failed to create custom-lp version");
  return row as CustomLpVersion;
}

/**
 * Editor-Lookup einer Version. Soft-gelöschte Versions werden bewusst
 * gefiltert — alle Editor-Surfaces (preview, activate, picker-update)
 * sollen sie als "weg" sehen. Für render-Pfade (Pipeline / Public-LP)
 * gibt es den unfilterten Lookup in `custom-lp-public.ts`, der die
 * gepinnte Version unabhängig vom Soft-Delete-Status auflöst.
 */
export async function getVersion(
  versionId: string,
  userId: string,
): Promise<{ version: CustomLpVersion; template: CustomLpTemplate }> {
  const [row] = await db
    .select({ version: customLpVersions, template: customLpTemplates })
    .from(customLpVersions)
    .innerJoin(
      customLpTemplates,
      eq(customLpVersions.templateId, customLpTemplates.id),
    )
    .where(
      and(
        eq(customLpVersions.id, versionId),
        eq(customLpTemplates.userId, userId),
        isNull(customLpVersions.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listVersions(
  templateId: string,
  userId: string,
): Promise<CustomLpVersion[]> {
  // Tenant-guard before we list to avoid an extra round-trip.
  await getTemplate(templateId, userId);
  return db
    .select()
    .from(customLpVersions)
    .where(
      and(
        eq(customLpVersions.templateId, templateId),
        isNull(customLpVersions.deletedAt),
      ),
    )
    .orderBy(asc(customLpVersions.version));
}

export async function countVersions(templateId: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(customLpVersions)
    .where(
      and(
        eq(customLpVersions.templateId, templateId),
        isNull(customLpVersions.deletedAt),
      ),
    );
  return row?.c ?? 0;
}

/**
 * Soft-Delete einer Custom-LP-Version (Paket G).
 *
 * Verhalten:
 *  - Idempotent: ein zweiter Aufruf auf eine bereits gelöschte Version
 *    ist ein no-op (returned `false`).
 *  - Tenant-guarded: nutzt den `getVersion`-Lookup für die User-Pruefung,
 *    fällt aber bei "schon gelöscht" sauber durch (404 wäre für den Caller
 *    irreführend, daher prüfen wir manuell auf das Template).
 *  - Wenn die zu löschende Version aktuell die `activeVersionId` des
 *    Templates ist, wird der Pointer auf NULL gesetzt. Andernfalls würde
 *    `listTemplatesForUser` durch den `deletedAt`-Filter im `leftJoin`
 *    plötzlich `activeVersion=null` anzeigen, der Template-Eintrag aber
 *    weiter `activeVersionId !== null` halten — UI-Drift.
 *  - Runs, die noch auf diese Version pinnen, bleiben unangetastet. Der
 *    Render-Pfad (`custom-lp-public.ts`) liest die Version explizit per
 *    ID und ignoriert `deletedAt` — Bestand-Runs überleben den Delete.
 *
 * Returns `true` wenn die Version durch diesen Call markiert wurde,
 * `false` wenn sie schon vorher soft-gelöscht war.
 */
export async function softDeleteCustomLpVersion(
  versionId: string,
  userId: string,
): Promise<boolean> {
  // Tenant-guard via direct join (NICHT `getVersion`, weil das auf
  // `deletedAt IS NULL` filtert und einen bereits gelöschten Pin als 404
  // melden würde — wir wollen aber idempotent sein).
  const [row] = await db
    .select({
      versionId: customLpVersions.id,
      templateId: customLpVersions.templateId,
      deletedAt: customLpVersions.deletedAt,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(customLpVersions)
    .innerJoin(
      customLpTemplates,
      eq(customLpVersions.templateId, customLpTemplates.id),
    )
    .where(
      and(
        eq(customLpVersions.id, versionId),
        eq(customLpTemplates.userId, userId),
      ),
    )
    .limit(1);

  if (!row) throw new Error("Not found");
  if (row.deletedAt !== null) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(customLpVersions)
      .set({ deletedAt: new Date() })
      .where(eq(customLpVersions.id, versionId));

    if (row.activeVersionId === versionId) {
      await tx
        .update(customLpTemplates)
        .set({ activeVersionId: null, updatedAt: new Date() })
        .where(eq(customLpTemplates.id, row.templateId));
    }
  });

  return true;
}

/**
 * Updates the annotations of a specific version. Used by Agent C's picker.
 */
export async function updateVersionAnnotations(
  versionId: string,
  userId: string,
  annotations: Record<string, unknown>,
): Promise<CustomLpVersion> {
  // Tenant guard via the joined template.
  await getVersion(versionId, userId);
  const [row] = await db
    .update(customLpVersions)
    .set({ annotations })
    .where(eq(customLpVersions.id, versionId))
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

// ── Run-pinning ─────────────────────────────────────────────────────────────

/**
 * All runs (across the user's campaigns) that currently pin a version of
 * the given template, joined with the campaign name for display.
 *
 * Tenant-guard: we filter by `runs.userId = userId` AND we check the
 * template ownership up-front via `getTemplate`. Defence in depth.
 */
export async function listAffectedRuns(
  templateId: string,
  userId: string,
): Promise<AffectedRunSummary[]> {
  await getTemplate(templateId, userId);

  const rows = await db
    .select({
      runId: runs.id,
      runName: runs.name,
      campaignId: runs.campaignId,
      campaignName: campaigns.name,
      pinnedVersionId: customLpVersions.id,
      pinnedVersionNumber: customLpVersions.version,
    })
    .from(runs)
    .innerJoin(campaigns, eq(runs.campaignId, campaigns.id))
    .innerJoin(
      customLpVersions,
      eq(runs.customLpVersionId, customLpVersions.id),
    )
    .where(
      and(
        eq(runs.userId, userId),
        eq(customLpVersions.templateId, templateId),
      ),
    )
    .orderBy(desc(runs.createdAt));

  return rows.map((r) => ({
    runId: r.runId,
    runName: r.runName,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    pinnedVersionId: r.pinnedVersionId,
    pinnedVersionNumber: r.pinnedVersionNumber,
  }));
}

/**
 * Sets the template's active-version pointer. Pure DB write — does not
 * touch runs. Callers that also want to repin runs should additionally
 * invoke `repinRuns`.
 */
export async function activateVersion(
  templateId: string,
  versionId: string,
  userId: string,
): Promise<CustomLpTemplate> {
  // Verify the version belongs to this template AND tenant.
  const { template, version } = await (async () => {
    const got = await getVersion(versionId, userId);
    return { template: got.template, version: got.version };
  })();
  if (template.id !== templateId) {
    throw new Error("Version does not belong to this template");
  }
  if (version.templateId !== templateId) {
    throw new Error("Version does not belong to this template");
  }
  return updateTemplate(templateId, userId, { activeVersionId: versionId });
}

/**
 * Repins a list of runs onto a specific version. Used after a new version
 * upload when the customer chooses "auch alte Runden auf neue Version".
 *
 * Returns the count of runs actually updated.
 */
export async function repinRuns(args: {
  userId: string;
  versionId: string;
  runIds: string[];
}): Promise<number> {
  if (args.runIds.length === 0) return 0;
  // Verify the target version is owned by the user.
  await getVersion(args.versionId, args.userId);
  const result = await db
    .update(runs)
    .set({ customLpVersionId: args.versionId })
    .where(and(eq(runs.userId, args.userId), inArray(runs.id, args.runIds)))
    .returning({ id: runs.id });
  return result.length;
}
