/**
 * Custom-Landingpage versions — collection endpoint.
 *
 *   GET  /api/custom-lp/[id]/versions
 *        List all versions of a template (tenant-guarded).
 *
 *   POST /api/custom-lp/[id]/versions
 *        Upload a fresh ZIP → validate → sanitize index.html →
 *        upload every file to Bunny → insert version row. Returns the new
 *        version plus the list of currently-pinned runs (so the caller can
 *        ask the user whether to repin existing runs).
 *
 *   Multipart form fields:
 *     - file        (required) — the ZIP buffer
 *     - annotations (optional) — JSON string from the picker; merged onto
 *                                whatever videocomet.json supplies.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Tell Next.js this route can accept large request bodies (default 1 MB
// would reject anything past a few KB). Vercel's edge runtime ignores this
// — we explicitly opted into nodejs above.
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createVersion,
  getTemplate,
  listAffectedRuns,
  listVersions,
  updateTemplate,
} from "@/lib/db/queries/custom-lp";
import { CUSTOM_LP_LIMITS } from "@/lib/custom-lp/types";
import { validateZip } from "@/lib/custom-lp/zip-validator";
import { sanitizeIndexHtml } from "@/lib/custom-lp/sanitizer";
import { buildFileManifest, normaliseManifest } from "@/lib/custom-lp/manifest";
import {
  buildVersionStoragePath,
  uploadFile,
  uploadManifest,
} from "@/lib/custom-lp/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const template = await getTemplate(params.id, auth.user.id);
    const versions = await listVersions(params.id, auth.user.id);
    return NextResponse.json({
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
    });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

/**
 * Parses the multipart form. We use the standard Web FormData API rather
 * than `formidable` because Next.js 14's app-router already integrates it.
 */
async function readUpload(req: NextRequest): Promise<{
  buffer: Buffer;
  filename: string;
  annotations: Record<string, unknown> | null;
} | { error: string; status: number }> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return {
      error:
        "Anfrage konnte nicht gelesen werden. Bitte verwenden Sie multipart/form-data.",
      status: 400,
    };
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return {
      error: "Es wurde keine ZIP-Datei übertragen (Feld \"file\" fehlt).",
      status: 400,
    };
  }
  // The File object can be larger than memory in theory; we accept the
  // 50 MB cap and read it fully — anything bigger is rejected by the
  // validator below before we touch Bunny.
  const arrayBuffer = await (file as File).arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > CUSTOM_LP_LIMITS.MAX_ZIP_BYTES) {
    return {
      error: `Die ZIP-Datei ist zu groß. Maximal sind ${
        CUSTOM_LP_LIMITS.MAX_ZIP_BYTES / (1024 * 1024)
      } MB erlaubt.`,
      status: 413,
    };
  }
  const annotationsRaw = form.get("annotations");
  let annotations: Record<string, unknown> | null = null;
  if (typeof annotationsRaw === "string" && annotationsRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(annotationsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        annotations = parsed as Record<string, unknown>;
      }
    } catch {
      return {
        error: "Das Feld \"annotations\" enthält kein gültiges JSON.",
        status: 400,
      };
    }
  }
  return {
    buffer,
    filename: (file as File).name || "upload.zip",
    annotations,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Tenant-guard: template must exist and belong to the user.
  try {
    await getTemplate(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const upload = await readUpload(req);
  if ("error" in upload) {
    return NextResponse.json({ error: upload.error }, { status: upload.status });
  }

  // 1. Validate the ZIP (size, paths, allow-list, anti-bomb).
  const validated = await validateZip(upload.buffer);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.message, code: validated.error, path: validated.path },
      { status: 422 },
    );
  }

  // 2. Sanitise the entry HTML in-place — every other file is uploaded as-is.
  const entryIndex = validated.files.findIndex(
    (f) => f.path === validated.entryHtml,
  );
  if (entryIndex >= 0) {
    const entry = validated.files[entryIndex]!;
    const sanitized = sanitizeIndexHtml(entry.content.toString("utf8"));
    validated.files[entryIndex] = {
      ...entry,
      content: Buffer.from(sanitized, "utf8"),
      size: Buffer.byteLength(sanitized, "utf8"),
      mime: "text/html; charset=utf-8",
    };
  }

  // 3. Decide what the next version number will be. We let `createVersion`
  //    compute it atomically (COALESCE(MAX(version), 0) + 1) so the storage
  //    path needs a small tweak: we upload to a TEMP prefix first, then
  //    rename via the DB. To keep things simple in v1, we read the current
  //    max once and trust the UNIQUE constraint to fence concurrent uploads.
  const versions = await listVersions(params.id, auth.user.id);
  const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
  const storagePath = `${buildVersionStoragePath(params.id, nextVersion)}/`;

  // 4. Build the file-manifest BEFORE upload so we can persist it even if
  //    a single PUT fails (we still have all hashes/sizes from in-memory).
  const fileManifestResult = buildFileManifest(validated.files);
  const normalisedManifest = normaliseManifest(validated.manifest);

  // 5. Upload every file. We deliberately use a small concurrency window —
  //    Bunny is generally fine with parallel PUTs, but we don't want to
  //    overwhelm a single tenant request.
  const CONCURRENCY = 8;
  const queue = [...validated.files];
  const failures: Array<{ path: string; reason: string }> = [];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const f = queue.shift();
      if (!f) return;
      try {
        await uploadFile({
          versionStoragePath: storagePath,
          filePath: f.path,
          content: f.content,
          contentType: f.mime,
        });
      } catch (err) {
        failures.push({
          path: f.path,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (failures.length > 0) {
    // Partial uploads are dangerous — bail and ask the user to retry. We
    // intentionally do not roll back successful uploads in v1 (cleanup is
    // done by the next successful upload overwriting `vN`).
    return NextResponse.json(
      {
        error:
          "Beim Hochladen ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
        details: failures.slice(0, 5),
      },
      { status: 502 },
    );
  }

  // 6. Upload the file-manifest as a sidecar JSON so the sandbox can read
  //    it without a DB round-trip if needed.
  try {
    await uploadManifest({
      versionStoragePath: storagePath,
      manifest: {
        version: nextVersion,
        entryHtml: validated.entryHtml,
        files: fileManifestResult.files,
        manifest: normalisedManifest,
      },
    });
  } catch (err) {
    // Best-effort — not fatal because the DB holds the canonical manifest.
    // eslint-disable-next-line no-console
    console.warn("[custom-lp] manifest sidecar upload failed:", err);
  }

  // 7. Insert the version row.
  // Merge the customer-supplied annotations onto any from videocomet.json.
  // Explicit picker annotations win over file-supplied ones.
  const mergedAnnotations: Record<string, unknown> | null =
    upload.annotations !== null || normalisedManifest?.annotations
      ? {
          ...(normalisedManifest?.annotations ?? {}),
          ...(upload.annotations ?? {}),
        }
      : null;

  const version = await createVersion({
    templateId: params.id,
    storagePath,
    entryHtml: normalisedManifest?.entry ?? validated.entryHtml,
    manifest: validated.manifest,
    fileManifest: fileManifestResult.files,
    annotations: mergedAnnotations,
    bytesTotal: fileManifestResult.bytesTotal,
  });

  // 8. If this is the FIRST version, auto-activate it.
  const template = await getTemplate(params.id, auth.user.id);
  if (template.activeVersionId === null) {
    await updateTemplate(params.id, auth.user.id, {
      activeVersionId: version.id,
    });
  }

  // 9. Affected runs = any run that pins ANY version of this template.
  const affectedRuns = await listAffectedRuns(params.id, auth.user.id);

  return NextResponse.json(
    {
      version: {
        id: version.id,
        version: version.version,
        entryHtml: version.entryHtml,
        bytesTotal: version.bytesTotal,
        uploadedAt: version.uploadedAt,
        storagePath: version.storagePath,
        annotations: version.annotations,
      },
      affectedRuns,
    },
    { status: 201 },
  );
}
