export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/brand/extract/[jobId] — Status der Brand-Erkennung.
 *
 * Response:
 *   {
 *     status: "pending" | "running" | "done" | "failed",
 *     phase?: "loading" | "analyzing",  // während running
 *     result?: { kit, logoCandidates }, // bei done
 *     error?: string                    // bei failed (freundlicher Text)
 *   }
 *
 * Tenant-Guard: das `userId`-Feld im Redis-Hash (vom POST geseedet) muss
 * zum Caller passen. Unbekannte/abgelaufene Jobs → 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getBrandExtractJobRedisKey } from "@/worker/brand-extract-queue";
import { getRedisConnection } from "@/worker/queue";
import type { BrandAnalysis } from "@/lib/brand-extract/analyze";

type BrandExtractStatus = "pending" | "running" | "done" | "failed";

function isStatus(s: string | undefined): s is BrandExtractStatus {
  return s === "pending" || s === "running" || s === "done" || s === "failed";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const jobId = params.jobId;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "Ungültige Job-ID." }, { status: 400 });
  }

  const redis = getRedisConnection();
  const fields = await redis.hgetall(getBrandExtractJobRedisKey(jobId));

  // hgetall liefert {} für fehlende Keys.
  if (!fields || Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "Job nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Tenant-Guard: ein Job ist nur für seinen Owner sichtbar.
  if (fields.userId && fields.userId !== auth.user.id) {
    return NextResponse.json(
      { error: "Job nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  const status: BrandExtractStatus = isStatus(fields.status)
    ? fields.status
    : "pending";

  if (status === "failed") {
    return NextResponse.json({
      status,
      error:
        fields.error ??
        "Die Analyse ist fehlgeschlagen. Du kannst deinen Look auch selbst festlegen.",
    });
  }

  if (status !== "done") {
    const payload: { status: BrandExtractStatus; phase?: string } = { status };
    if (fields.phase === "loading" || fields.phase === "analyzing") {
      payload.phase = fields.phase;
    }
    return NextResponse.json(payload);
  }

  // status === "done": result-JSON defensiv parsen — ein korrupter Hash
  // darf das Polling nicht crashen, sondern wird als Fehler ausgewiesen.
  let result: BrandAnalysis | null = null;
  if (fields.result) {
    try {
      result = JSON.parse(fields.result) as BrandAnalysis;
    } catch {
      result = null;
    }
  }
  if (!result) {
    return NextResponse.json({
      status: "failed" as const,
      error:
        "Die Analyse ist fehlgeschlagen. Du kannst deinen Look auch selbst festlegen.",
    });
  }

  return NextResponse.json({ status: "done" as const, result });
}
