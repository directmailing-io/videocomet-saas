/**
 * Brand-Extraktions-Processor.
 *
 * Ablauf pro Job:
 *   1. Redis-Hash → status=running, phase=loading
 *   2. `runBrandExtraction` (Puppeteer, Browser-Pool) → phase=analyzing
 *   3. status=done + result-JSON  { kit, logoCandidates }
 *
 * Schreibt IMMER einen terminalen Zustand (done/failed) bevor er
 * returned/wirft, damit das Polling nie in `running` hängen bleibt.
 * Fehler landen als freundliche deutsche Meldung im `error`-Feld
 * (technisches Detail separat in `errorDetail` für Logs/Debugging).
 * Am Ende wird das 1-Job-pro-User-Lock freigegeben.
 */

import type { Job } from "bullmq";
import {
  BrandExtractFailedError,
  friendlyExtractionError,
  runBrandExtraction,
  type BrandExtractPhase,
} from "../lib/brand-extract";
import {
  BRAND_EXTRACT_REDIS_TTL_SECONDS,
  getBrandExtractJobRedisKey,
  getBrandExtractUserLockKey,
  type BrandExtractJobData,
} from "../brand-extract-queue";
import { getRedisConnection } from "../queue";
import type { BrandAnalysis } from "@/lib/brand-extract/analyze";

export type { BrandExtractJobData };

async function writeJobStatus(
  jobId: string,
  fields: {
    status: "pending" | "running" | "done" | "failed";
    phase?: BrandExtractPhase;
    result?: string;
    error?: string;
    errorDetail?: string;
  },
): Promise<void> {
  const redis = getRedisConnection();
  const key = getBrandExtractJobRedisKey(jobId);
  const payload: Record<string, string> = { status: fields.status };
  if (fields.phase !== undefined) payload.phase = fields.phase;
  if (fields.result !== undefined) payload.result = fields.result;
  if (fields.error !== undefined) payload.error = fields.error;
  if (fields.errorDetail !== undefined)
    payload.errorDetail = fields.errorDetail;
  await redis.hset(key, payload);
  await redis.expire(key, BRAND_EXTRACT_REDIS_TTL_SECONDS);
}

/**
 * Gibt das User-Lock frei — aber nur, wenn es noch DIESEM Job gehört
 * (der POST schreibt die jobId als Lock-Value). Verhindert, dass ein
 * langsamer alter Job das Lock eines frisch gestarteten Jobs löscht.
 */
async function releaseUserLock(userId: string, jobId: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    const key = getBrandExtractUserLockKey(userId);
    const owner = await redis.get(key);
    if (owner === jobId) await redis.del(key);
  } catch {
    // Lock läuft ohnehin per TTL aus — nie den Job daran scheitern lassen.
  }
}

export async function brandExtractProcessor(
  job: Job<BrandExtractJobData>,
): Promise<BrandAnalysis> {
  const { jobId, userId, url } = job.data;

  await writeJobStatus(jobId, { status: "running", phase: "loading" });

  try {
    const analysis = await runBrandExtraction(url, async (phase) => {
      await writeJobStatus(jobId, { status: "running", phase }).catch(
        () => undefined,
      );
    });

    await writeJobStatus(jobId, {
      status: "done",
      result: JSON.stringify(analysis),
    });
    return analysis;
  } catch (err) {
    const friendly =
      err instanceof BrandExtractFailedError
        ? err.message
        : friendlyExtractionError(url);
    const detail =
      err instanceof BrandExtractFailedError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);
    await writeJobStatus(jobId, {
      status: "failed",
      error: friendly,
      errorDetail: detail,
    }).catch(() => undefined);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    await releaseUserLock(userId, jobId);
  }
}
