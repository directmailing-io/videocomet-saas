/**
 * Fire-and-forget enqueue helper for CRM-Sync jobs.
 *
 * Called from the tracker hot path (after `insertLeadEvent` succeeds) and
 * from manual `/api/.../crm-test-sync` endpoints. The contract is strict:
 * this function NEVER throws. Any error is swallowed + console.error'd so
 * the calling endpoint always returns its 204 to the browser.
 *
 * Two-step gating:
 *   1. In-process 60s cache check ("does this lead's campaign have any
 *      enabled CRM-sync settings AND does that settings row enable this
 *      particular event kind?"). Cuts ~99% of tracker traffic before it
 *      ever hits Redis — most leads belong to campaigns without CRM.
 *   2. BullMQ add with `jobId = ${leadId}:${kind}` + 30s delay. BullMQ
 *      silently dedups by jobId for jobs in waiting/delayed/active so
 *      rapid bursts of the same event collapse to ONE eventual push.
 *
 * Why 30s? Long enough to absorb the typical "open → scroll → play"
 * burst into a single CRM update, short enough that the rep watching
 * their CRM still feels real-time. Tuned to keep cost down on metered
 * APIs like HubSpot.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignCrmSettings, crmIntegrations, leads } from "@/lib/db/schema";
import {
  crmSyncQueue,
  type CrmSyncEventKind,
  type CrmSyncJob,
} from "@/worker/crm-queue";

const DEBOUNCE_DELAY_MS = 30_000;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  /** Per-kind enable flags — true means "this lead's campaign syncs this
   *  event kind". A campaign without CRM settings caches `{}` so the next
   *  60s of events return immediately. */
  enabledKinds: Partial<Record<CrmSyncEventKind, boolean>>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Strip stale entries opportunistically so the Map doesn't grow without
 * bound when many one-off leads come through (e.g. mass-CSV runs). Keeps
 * the in-memory footprint bounded by the active 60s window.
 */
function cleanupCache(now: number): void {
  if (cache.size < 1000) return;
  // Array.from avoids the downlevelIteration requirement for Map iteration
  // under tsconfig targets <ES2015.
  for (const [k, v] of Array.from(cache.entries())) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

/**
 * Look up whether this lead's campaign has CRM-sync enabled for this
 * particular event kind. Returns a fresh cache entry; populates the
 * `enabledKinds` for ALL three kinds in one query so the next two
 * different-kind events for the same lead are cache hits too.
 */
async function loadEnabledKinds(leadId: string): Promise<CacheEntry["enabledKinds"]> {
  const [row] = await db
    .select({
      enabled: campaignCrmSettings.enabled,
      enabledEvents: campaignCrmSettings.enabledEvents,
      disabledAt: crmIntegrations.disabledAt,
    })
    .from(leads)
    .innerJoin(
      campaignCrmSettings,
      eq(campaignCrmSettings.campaignId, leads.campaignId),
    )
    .innerJoin(
      crmIntegrations,
      eq(crmIntegrations.id, campaignCrmSettings.crmIntegrationId),
    )
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) return {};
  if (!row.enabled || row.disabledAt) return {};

  const enabledKinds: CacheEntry["enabledKinds"] = {};
  const list = Array.isArray(row.enabledEvents) ? row.enabledEvents : [];
  for (const k of ["page_view", "video_play", "cta_click"] as const) {
    if (list.includes(k)) enabledKinds[k] = true;
  }
  return enabledKinds;
}

async function isEnabledFor(
  leadId: string,
  kind: CrmSyncEventKind,
): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(leadId);
  if (cached && cached.expiresAt > now) {
    return cached.enabledKinds[kind] === true;
  }
  cleanupCache(now);
  const enabledKinds = await loadEnabledKinds(leadId);
  cache.set(leadId, { enabledKinds, expiresAt: now + CACHE_TTL_MS });
  return enabledKinds[kind] === true;
}

export interface EnqueueCrmSyncInput {
  leadId: string;
  kind: CrmSyncSourceKind;
}

/**
 * Internal-event vocabulary (matches `LeadEventKind` in lead-events.ts +
 * a few historical aliases). We narrow to the 3 CRM kinds via
 * `mapEventKindToCrm` below; callers may pass either form.
 */
export type CrmSyncSourceKind = CrmSyncEventKind | string;

/**
 * Maps the internal `lead_events.kind` vocabulary to the 3 CRM event
 * kinds we sync. Anything not in this list returns `null` — the caller
 * skips the enqueue entirely. Aliases like `lead_open`/`view`/`play` are
 * here for legacy tracker payloads that pre-date the canonical kinds.
 */
export function mapEventKindToCrm(kind: string): CrmSyncEventKind | null {
  switch (kind) {
    case "page_view":
    case "lead_open":
    case "landingpage_open":
    case "view":
      return "page_view";
    case "video_play":
    case "play":
    case "video_start":
      return "video_play";
    case "cta_click":
      return "cta_click";
    default:
      return null;
  }
}

/**
 * Enqueue a CRM-sync job for this (lead, kind). Idempotent + fire-and-
 * forget; the caller MUST `void` the returned promise (and never await
 * on the tracker hot path).
 *
 * `force: true` skips the cache + dedup gate by using a unique job id —
 * used by the manual `/api/.../crm-test-sync` admin endpoint so reps
 * can verify a CRM connection on demand even mid-debounce-window.
 */
export async function enqueueCrmSync(args: {
  leadId: string;
  kind: CrmSyncEventKind;
  force?: boolean;
}): Promise<void> {
  try {
    // Force path: skip cache; the test-sync caller has already gated on
    // settings.enabled + integration in its own route handler.
    if (!args.force) {
      const enabled = await isEnabledFor(args.leadId, args.kind);
      if (!enabled) return;
    }

    const queue = crmSyncQueue();
    const data: CrmSyncJob = {
      leadId: args.leadId,
      kind: args.kind,
      ts: Date.now(),
      force: args.force,
    };

    if (args.force) {
      // Unique jobId → BullMQ never dedups. Caller wants this push NOW.
      await queue.add(`crm-sync-force`, data, {
        // Skip the 30s debounce delay for force-pushes — the user is
        // staring at the UI waiting for the "Pushed!" toast.
        delay: 0,
      });
    } else {
      await queue.add(`crm-sync`, data, {
        jobId: `${args.leadId}:${args.kind}`,
        delay: DEBOUNCE_DELAY_MS,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[crm:enqueue] failed for lead=${args.leadId} kind=${args.kind}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Test-only: drop the in-process cache so the next call hits the DB
 * fresh. Not exported from the public lib barrel — only the test suite
 * for this module imports it.
 */
export function _resetEnqueueCacheForTests(): void {
  cache.clear();
}
