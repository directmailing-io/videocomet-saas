/**
 * Phase-1 Preflight processor.
 *
 * Runs ONCE per Lead, after the operator triggered a Run but BEFORE any
 * expensive video render. Responsibilities, in order:
 *
 *   1. Sanity-check: is the parent Run still in `preflighting`? If not we
 *      silent-skip (Run was cancelled — no point doing work or writing).
 *   2. Mark the Lead as `preflight_status = 'running'` + bump attempts.
 *      We RETURN the previous value so the caller could audit, but the
 *      processor itself doesn't read it back.
 *   3. Resolve the Lead's website URL from `leads.data` (multiple known
 *      keys; first non-empty wins). If none, mark `missing_field` and
 *      exit cleanly (no throw — this is an expected per-lead outcome).
 *   4. Run the URL-probe. Any non-`ok` outcome short-circuits to a final
 *      DB update — we do NOT screenshot a URL that's already classified as
 *      broken/parking/bot-blocked. That avoids paying ~1s of Chromium time
 *      per dead lead and keeps the operator's grid focused on signal.
 *   5. On `ok`, capture the light screenshot, upload to Bunny, and write
 *      the success row. Screenshot failures degrade gracefully to
 *      `screenshot_unavailable` (the URL is still reachable so the lead
 *      may still be approvable manually).
 *   6. After every job, idempotently check whether the parent run can be
 *      promoted to `awaiting_approval`. This is the operator's "ready to
 *      review" signal.
 *
 * Concurrency-safety:
 *   - All updates are scoped to a single Lead row except the run-promotion
 *     step, which uses a WHERE-on-old-status check so two workers racing
 *     on the same last-lead cannot double-promote.
 *   - We never throw on operationally-expected failures (missing field,
 *     dead URL, screenshot timeout). Throwing would trigger BullMQ retries
 *     which would just re-burn budget on the same failure. We DO throw on
 *     truly unexpected errors (DB down, Redis down, …) so BullMQ surfaces
 *     them in the failed list.
 */

import type { Job } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  uploadPreflightScreenshot,
} from "@/lib/bunny/preflight-storage";
import { probeUrl, type UrlProbeResult } from "@/lib/preflight/url-probe";
import { captureLightScreenshot } from "@/lib/preflight/screenshot";
import type { PreflightJobData } from "../types";

/**
 * The Drizzle-generated `runs.status` type is intentionally NARROW (only the
 * six original values). Agent 1 noted this in schema.ts: the Postgres ENUM
 * has the extended values (`preflighting`, `awaiting_approval`, `approved`),
 * but the TS type is kept tight so existing UI switch-statements stay
 * exhaustive. Code that needs to set or compare an extended value casts —
 * see `queries/runs.ts → setRunStatus()` for the same pattern.
 */
type RunStatusValue = typeof runs.$inferSelect.status;

/**
 * Terminal status values — once a Lead is in one of these, the parent Run
 * may be eligible for promotion to `awaiting_approval`. Mirrors the spec
 * exactly.
 */
const TERMINAL_PREFLIGHT_STATUSES: readonly string[] = [
  "ok",
  "url_dead",
  "url_redirect",
  "missing_field",
  "duplicate",
  "tls_error",
  "slow",
  "bot_block",
  "screenshot_unavailable",
  "unknown_error",
];

/** Candidate column-names for the Lead's website URL, in priority order. */
const WEBSITE_URL_KEYS: readonly string[] = [
  "websiteUrl",
  "website",
  "url",
  "webseite",
];

/**
 * Resolves the first non-empty website URL from `leads.data` using the
 * known key set. Falls back to a case-insensitive scan so CSV authors who
 * shipped `WebsiteURL` or `Website` get matched too.
 */
function pickWebsiteUrl(data: Record<string, string> | null | undefined): string | null {
  if (!data) return null;
  for (const k of WEBSITE_URL_KEYS) {
    const v = data[k];
    if (v && v.trim()) return v.trim();
  }
  // Case-insensitive fallback — built lazily because most rows hit the
  // direct lookup above.
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    lower.set(k.toLowerCase(), v);
  }
  for (const k of WEBSITE_URL_KEYS) {
    const v = lower.get(k.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Maps a `UrlProbeResult` status to the matching `leads.preflight_status`
 * value from the DB enum. The URL-probe layer uses slightly different names
 * (e.g. `url_redirect_parking`) for its internal classes — this is where
 * we collapse them into the persisted vocabulary.
 */
function mapProbeStatusToDb(
  status: UrlProbeResult["status"],
): string {
  switch (status) {
    case "ok":
      return "ok";
    case "url_dead":
      return "url_dead";
    case "url_redirect_parking":
      return "url_redirect";
    case "tls_error":
      return "tls_error";
    case "slow":
      return "slow";
    case "bot_block":
      return "bot_block";
    case "dns_error":
      return "url_dead";
    default:
      return "unknown_error";
  }
}

/**
 * If every Lead in this Run has a terminal preflight_status, flip the Run
 * to `awaiting_approval` and stamp `preflight_completed_at`. Uses a
 * WHERE-condition on `status='preflighting'` so two workers racing on the
 * last Lead cannot both promote (only the first UPDATE matches).
 */
async function maybePromoteRunToAwaitingApproval(runId: string): Promise<void> {
  // Count non-terminal leads. A small query — runs typically have <2000
  // leads and the status index makes this O(few ms).
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${leads.preflightStatus} not in (${sql.join(
        TERMINAL_PREFLIGHT_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )}))::int`,
    })
    .from(leads)
    .where(eq(leads.runId, runId));

  if (!row) return;
  if (row.pending > 0) return;
  if (row.total === 0) return; // empty run — leave as-is (operator may delete)

  // Idempotent promotion: WHERE-status guarantees only the first race wins.
  // The "preflighting" / "awaiting_approval" enum values live in the DB ENUM
  // but not in the narrow TS type — same cast pattern as setRunStatus().
  await db
    .update(runs)
    .set({
      status: "awaiting_approval" as RunStatusValue,
      preflightCompletedAt: new Date(),
    })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "preflighting" as RunStatusValue),
      ),
    );
}

/**
 * Entry point invoked from the worker boot file. Always one Lead per Job.
 *
 * Resolves cleanly on EXPECTED outcomes (dead URL, missing field, screenshot
 * timeout). Throws only on infra failures (DB unreachable, Redis dead) so
 * BullMQ surfaces them in the failed list for operator visibility.
 */
export async function processPreflightJob(
  job: Job<PreflightJobData>,
): Promise<void> {
  const { leadId, runId } = job.data;

  // ── Step 1: Run-status sanity check ───────────────────────────────────
  // If the run has been cancelled (or already promoted past preflight), we
  // do nothing. The job stays "completed" so it doesn't sit in failed
  // forever; the Lead row simply isn't touched.
  const [runRow] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  if (!runRow) {
    // Run row gone — possibly hard-deleted. Nothing to do.
    return;
  }
  // Same narrow-vs-wide-enum dance: cast on the COMPARISON side, never on
  // the runtime value (which is whatever Postgres returned).
  if ((runRow.status as string) !== "preflighting") {
    // Cancelled / already approved / already generating. Silent skip.
    return;
  }

  // ── Step 2: Mark lead running + bump attempts ─────────────────────────
  // We use `returning()` so a follow-up debug log can attribute which
  // attempt this is; we don't otherwise read the data.
  const [leadRow] = await db
    .update(leads)
    .set({
      preflightStatus: "running",
      preflightAttempts: sql`${leads.preflightAttempts} + 1`,
    })
    .where(eq(leads.id, leadId))
    .returning({
      id: leads.id,
      data: leads.data,
      attempts: leads.preflightAttempts,
    });

  if (!leadRow) {
    // Lead deleted between enqueue and run. Nothing to do.
    return;
  }

  // ── Step 3: Resolve URL from lead.data ────────────────────────────────
  const websiteUrl = pickWebsiteUrl(leadRow.data);
  if (!websiteUrl) {
    await db
      .update(leads)
      .set({
        preflightStatus: "missing_field",
        preflightErrorMessage: "no website url in lead data",
        preflightCompletedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    await maybePromoteRunToAwaitingApproval(runId);
    return;
  }

  // Honour an external abort (e.g. run cancellation) at every await-point.
  const signal = (job as unknown as { signal?: AbortSignal }).signal;

  // ── Step 4: URL probe ─────────────────────────────────────────────────
  // Probe-Outcomes werden in zwei Klassen geteilt:
  //
  //  Hard-Reject (kein Screenshot, Status direkt persistieren):
  //   - dns_error            (Domain existiert nicht)
  //   - bot_block            (Cloudflare/Datadome/Akamai blocken auch Puppeteer
  //                           — Versuch wäre nur ein 15s-Hang)
  //   - tls_error            (HTTPS-Cert kaputt; Puppeteer würde ebenfalls
  //                           scheitern)
  //   - url_redirect_parking (Final-URL ist Parking-Domain)
  //
  //  Pass-Through (Screenshot trotzdem versuchen):
  //   - url_dead             (HEAD lieferte 4xx/5xx — viele Sites blocken
  //                           HEAD aber liefern auf GET via Browser sauberen
  //                           Inhalt)
  //   - slow                 (HEAD braucht lange — Browser sieht oft etwas)
  //   - ok                   (offensichtlich)
  const probe = await probeUrl(websiteUrl, signal);
  const probeHardReject =
    probe.status === "dns_error" ||
    probe.status === "bot_block" ||
    probe.status === "tls_error" ||
    probe.status === "url_redirect_parking";

  if (probeHardReject) {
    await db
      .update(leads)
      .set({
        preflightStatus: mapProbeStatusToDb(probe.status),
        preflightFinalUrl: probe.finalUrl,
        preflightHttpStatus: probe.httpStatus,
        preflightErrorMessage: probe.errorMessage,
        preflightDurationMs: probe.durationMs,
        preflightCompletedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    await maybePromoteRunToAwaitingApproval(runId);
    return;
  }

  // ── Step 5: Screenshot + upload ───────────────────────────────────────
  const captureUrl = probe.finalUrl ?? websiteUrl;
  try {
    const shot = await captureLightScreenshot({ url: captureUrl, signal });
    const upload = await uploadPreflightScreenshot({
      runId,
      leadId,
      webp: shot.webp,
    });
    await db
      .update(leads)
      .set({
        preflightStatus: "ok",
        preflightScreenshotUrl: upload.url,
        preflightScreenshotKey: upload.key,
        preflightFinalUrl: probe.finalUrl,
        preflightHttpStatus: probe.httpStatus,
        // Sum probe duration + screenshot duration so the grid's perf
        // column reflects total "time spent on this lead".
        preflightDurationMs: probe.durationMs + shot.durationMs,
        preflightErrorMessage: null,
        preflightCompletedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Wenn auch der echte Browser scheitert, fallen wir auf die Probe-
    // Klassifizierung zurück (sie liefert dann den Grund — Bot-Block,
    // TLS-Fehler etc.). Wenn die Probe selber OK war und nur das Bild
    // nicht klappte, ist's `screenshot_unavailable`.
    const fallbackStatus = probe.ok
      ? "screenshot_unavailable"
      : mapProbeStatusToDb(probe.status);
    await db
      .update(leads)
      .set({
        preflightStatus: fallbackStatus,
        preflightFinalUrl: probe.finalUrl,
        preflightHttpStatus: probe.httpStatus,
        preflightErrorMessage: probe.ok
          ? `screenshot: ${message}`
          : probe.errorMessage ?? `screenshot: ${message}`,
        preflightDurationMs: probe.durationMs,
        preflightCompletedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
  }

  // ── Step 6: Run-level promotion check ─────────────────────────────────
  await maybePromoteRunToAwaitingApproval(runId);
}
