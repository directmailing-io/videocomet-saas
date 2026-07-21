/**
 * URLSearchParams → ActivityFilters
 *
 * Parses the Aktivitäts-Center URL-DSL into a typed ActivityFilters object
 * that can be passed straight into Agent 1's query layer
 * (`getActivityFeed`, `getActivityCounts`, `getFunnel`, `getLeadsForExport`).
 *
 * Robustness rules:
 *  - Unknown params are silently ignored (forward-compatible).
 *  - Whitelists for `kind` and `temperature` reject unknown values with a 400.
 *  - All UUIDs are validated. Malformed values yield a 400.
 *  - `limit` is clamped to 1..200 (default 50).
 *  - When `from`/`to` are missing, the last-30-day window is applied.
 */

import {
  type ActivityFilters,
  type ActivityScope,
  type LeadTemperature,
} from "@/lib/activity/types";
import {
  LEAD_EVENT_KINDS,
  isLeadEventKind,
  type LeadEventKind,
} from "@/lib/db/queries/lead-events";

const TEMPERATURES: readonly LeadTemperature[] = [
  "cold",
  "warm",
  "hot",
  "inactive",
] as const;

const SCOPES: readonly ActivityScope["kind"][] = [
  "global",
  "campaign",
  "run",
  "lead",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_WINDOW_DAYS = 30;

type ParseResult = ActivityFilters | { error: string };

export function parseFilters(
  searchParams: URLSearchParams,
  // userId is part of the documented signature (forward-compat: future
  // user-scoped DSL extensions). The current `ActivityFilters` shape has no
  // userId field — tenant-guarding happens via the explicit userId argument
  // on the query layer.
  userId: string,
): ParseResult {
  void userId;
  // ── scope ────────────────────────────────────────────────────────────────
  const scopeParam = (searchParams.get("scope") ?? "global").toLowerCase();
  if (!(SCOPES as readonly string[]).includes(scopeParam)) {
    return { error: `Unbekannter Scope: ${scopeParam}` };
  }

  let scope: ActivityScope;
  if (scopeParam === "global") {
    scope = { kind: "global" };
  } else if (scopeParam === "campaign") {
    const id = searchParams.get("campaignId");
    if (!id || !UUID_RE.test(id)) {
      return { error: "Ungültige campaignId für scope=campaign." };
    }
    scope = { kind: "campaign", campaignId: id };
  } else if (scopeParam === "run") {
    const id = searchParams.get("runId");
    if (!id || !UUID_RE.test(id)) {
      return { error: "Ungültige runId für scope=run." };
    }
    scope = { kind: "run", runId: id };
  } else {
    const id = searchParams.get("leadId");
    if (!id || !UUID_RE.test(id)) {
      return { error: "Ungültige leadId für scope=lead." };
    }
    scope = { kind: "lead", leadId: id };
  }

  // ── date window (default: last 30 days) ──────────────────────────────────
  const now = new Date();
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  let from: Date;
  if (fromRaw) {
    const parsed = parseDate(fromRaw);
    if (!parsed) return { error: `Ungültiges from-Datum: ${fromRaw}` };
    from = parsed;
  } else {
    from = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  let to: Date;
  if (toRaw) {
    const parsed = parseDate(toRaw);
    if (!parsed) return { error: `Ungültiges to-Datum: ${toRaw}` };
    to = parsed;
  } else {
    to = now;
  }

  if (from.getTime() > to.getTime()) {
    return { error: "from-Datum liegt nach to-Datum." };
  }

  // ── kinds (whitelist) ────────────────────────────────────────────────────
  let kinds: LeadEventKind[] | undefined;
  const kindRaw = searchParams.get("kind");
  if (kindRaw) {
    const parts = splitCsv(kindRaw);
    const out: LeadEventKind[] = [];
    for (const p of parts) {
      if (!isLeadEventKind(p)) {
        return {
          error: `Unbekannte Event-Art: ${p}. Erlaubt: ${LEAD_EVENT_KINDS.join(", ")}`,
        };
      }
      if (!out.includes(p)) out.push(p);
    }
    if (out.length > 0) kinds = out;
  }

  // ── temperatures (whitelist) ─────────────────────────────────────────────
  let temperatures: LeadTemperature[] | undefined;
  const tempRaw = searchParams.get("temperature");
  if (tempRaw) {
    const parts = splitCsv(tempRaw);
    const out: LeadTemperature[] = [];
    for (const p of parts) {
      if (!(TEMPERATURES as readonly string[]).includes(p)) {
        return {
          error: `Unbekannte Temperatur: ${p}. Erlaubt: ${TEMPERATURES.join(", ")}`,
        };
      }
      const t = p as LeadTemperature;
      if (!out.includes(t)) out.push(t);
    }
    if (out.length > 0) temperatures = out;
  }

  // ── multi-select campaignId / runId (independent of scope) ───────────────
  let campaignIds: string[] | undefined;
  const campaignIdRaw = searchParams.get("campaignId");
  if (scopeParam !== "campaign" && campaignIdRaw) {
    const parts = splitCsv(campaignIdRaw);
    for (const p of parts) {
      if (!UUID_RE.test(p)) {
        return { error: `Ungültige campaignId: ${p}` };
      }
    }
    if (parts.length > 0) campaignIds = dedupe(parts);
  }

  let runIds: string[] | undefined;
  const runIdRaw = searchParams.get("runId");
  if (scopeParam !== "run" && runIdRaw) {
    const parts = splitCsv(runIdRaw);
    for (const p of parts) {
      if (!UUID_RE.test(p)) {
        return { error: `Ungültige runId: ${p}` };
      }
    }
    if (parts.length > 0) runIds = dedupe(parts);
  }

  // ── search (trim, max 200 chars) ─────────────────────────────────────────
  let search: string | undefined;
  const searchRaw = searchParams.get("search");
  if (searchRaw) {
    const trimmed = searchRaw.trim().slice(0, 200);
    if (trimmed.length > 0) search = trimmed;
  }

  // ── cursor (opaque, base64) ──────────────────────────────────────────────
  let cursor: string | undefined;
  const cursorRaw = searchParams.get("cursor");
  if (cursorRaw && cursorRaw.length > 0 && cursorRaw.length <= 1024) {
    cursor = cursorRaw;
  }

  // ── limit (clamp) ────────────────────────────────────────────────────────
  let limit = DEFAULT_LIMIT;
  const limitRaw = searchParams.get("limit");
  if (limitRaw) {
    const n = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: "limit muss eine positive Ganzzahl sein." };
    }
    limit = Math.min(Math.max(n, 1), MAX_LIMIT);
  }

  const filters: ActivityFilters = {
    scope,
    from,
    to,
    kinds,
    temperature: temperatures,
    campaignIds,
    runIds,
    search,
    cursor,
    limit,
  };

  return filters;
}

function parseDate(raw: string): Date | null {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
