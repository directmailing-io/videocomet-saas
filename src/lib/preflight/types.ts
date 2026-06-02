/**
 * Shared types for the Lead-Quality-Check / Preflight subsystem.
 *
 * Used by:
 *   - the API routes under `/api/runs/[id]/preflight/*`
 *   - the inline-validation module (`./inline-validate.ts`)
 *   - the (forthcoming) BullMQ worker for the `lead-preflight` queue
 *   - the (forthcoming) UI under `/runs/[id]/preflight`
 *
 * The PreflightLeadRow shape is the wire-contract for the grid UI and must
 * not break without coordinating with the frontend consumer.
 */

/** Persisted on `leads.preflight_status`. */
export type PreflightStatus =
  | "pending"
  | "running"
  | "ok"
  | "url_dead"
  | "url_redirect"
  | "missing_field"
  | "duplicate"
  | "tls_error"
  | "slow"
  | "bot_block"
  | "screenshot_unavailable"
  | "unknown_error";

/**
 * Terminal preflight states a lead can land in. Used to compute the
 * "problematic" counter on the status endpoint and to decide whether a
 * lead is still in-flight.
 */
export const PREFLIGHT_TERMINAL_STATUSES: PreflightStatus[] = [
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

export const PREFLIGHT_PROBLEMATIC_STATUSES: PreflightStatus[] = [
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

/**
 * Wire shape returned by GET /api/runs/[id]/preflight/leads.
 * The UI grid (Agent 3) consumes this shape directly. Field names mirror
 * the Drizzle camelCase convention; dates are serialized as ISO strings so
 * `JSON.parse(JSON.stringify(row))` round-trips without surprises.
 */
export interface PreflightLeadRow {
  id: string;
  runId: string;
  rowIndex: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyName: string | null;
  websiteUrl: string | null;
  preflightStatus: string;
  preflightFinalUrl: string | null;
  preflightHttpStatus: number | null;
  preflightDurationMs: number | null;
  preflightErrorMessage: string | null;
  preflightScreenshotUrl: string | null;
  preflightAttempts: number;
  duplicateOfLeadId: string | null;
  removedAt: string | null;
  approvedAt: string | null;
}

/** Aggregate counters for the status endpoint + SSE periodic ticks. */
export interface PreflightCounts {
  pending: number;
  running: number;
  ok: number;
  problematic: number;
  removed: number;
  total: number;
}

/** Issue keys returned by the inline-validation pass. */
export type InlineValidationIssue =
  | "missing_firstName"
  | "missing_websiteUrl"
  | "invalid_email"
  | "invalid_url";

export interface InlineValidationResult {
  ok: boolean;
  issues: InlineValidationIssue[];
}
