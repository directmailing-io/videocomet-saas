/**
 * Single Custom-Landingpage template:
 *
 *   GET    /api/custom-lp/[id]   Detail + version list + affected-runs count.
 *   PATCH  /api/custom-lp/[id]   Rename / update description.
 *   DELETE /api/custom-lp/[id]   Cascade delete — refuses if any run pins
 *                                a version of this template (409).
 *
 * Note on storage cleanup: DELETE only removes DB rows. The Bunny storage
 * objects are deleted lazily by the version-delete path (or admin tooling).
 * Deleting through the DB cascade alone would silently leave orphaned
 * objects in the bucket — which is acceptable for the v1 (we don't auto-
 * clean storage from the API because Bunny LIST + DELETE per file is slow
 * and would block the request).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteTemplate,
  getTemplate,
  listAffectedRuns,
  listVersions,
  updateTemplate,
} from "@/lib/db/queries/custom-lp";

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2_000).nullish(),
    thumbnailUrl: z.string().url().nullish(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.description !== undefined ||
      d.thumbnailUrl !== undefined,
    { message: "Mindestens ein Feld muss angegeben werden." },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const template = await getTemplate(params.id, auth.user.id);
    const versions = await listVersions(params.id, auth.user.id);
    const affected = await listAffectedRuns(params.id, auth.user.id);
    return NextResponse.json({
      template,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        entryHtml: v.entryHtml,
        bytesTotal: v.bytesTotal,
        uploadedAt: v.uploadedAt,
        storagePath: v.storagePath,
        annotations: v.annotations,
        isActive: template.activeVersionId === v.id,
      })),
      affectedRunsCount: affected.length,
    });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

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
    const template = await updateTemplate(params.id, auth.user.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.thumbnailUrl !== undefined ? { thumbnailUrl: body.thumbnailUrl } : {}),
    });
    return NextResponse.json({ template });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    await deleteTemplate(params.id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "TEMPLATE_IN_USE") {
      return NextResponse.json(
        {
          error:
            "Diese Vorlage ist aktuell noch in einer oder mehreren Runden " +
            "gepinnt. Bitte lösen Sie die Bindung in den betroffenen Runden, " +
            "bevor Sie die Vorlage löschen.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}
