/**
 * Shared types for the Aktivitäts-Center.
 *
 * The Activity-Center renders tracking-events on four hierarchical scopes
 * (global / campaign / run / lead). All wire shapes between the query layer
 * (this module's `activity.ts` sibling), the API layer (Agent 2) and the UI
 * (Agent 3) live here so the three agents share exactly one source of truth.
 */

export type LeadTemperature = "cold" | "warm" | "hot" | "inactive";

export const LEAD_TEMPERATURES: readonly LeadTemperature[] = [
  "cold",
  "warm",
  "hot",
  "inactive",
] as const;

export type ActivityScope =
  | { kind: "global" }
  | { kind: "campaign"; campaignId: string }
  | { kind: "run"; runId: string }
  | { kind: "lead"; leadId: string };

export interface ActivityFilters {
  scope: ActivityScope;
  from?: Date;
  to?: Date;
  /** event kind allowlist; empty/undefined ⇒ all kinds */
  kinds?: string[];
  temperature?: LeadTemperature[];
  /** matches lead first/last/full-name, company, slug */
  search?: string;
  campaignIds?: string[];
  runIds?: string[];
  /** default 50, max 200 */
  limit?: number;
  /** opaque keyset cursor, see ActivityCursor below */
  cursor?: string;
}

export interface ActivityFeedRow {
  eventId: string;
  /** ISO-8601 UTC */
  ts: string;
  kind: string;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  lead: {
    id: string;
    name: string;
    companyName: string | null;
    slug: string | null;
    temperature: LeadTemperature;
  };
  run: { id: string; name: string };
  campaign: { id: string; name: string };
}

export interface ActivityCounts {
  total: number;
  byKind: Record<string, number>;
  byTemperature: Record<LeadTemperature, number>;
  uniqueLeads: number;
  uniqueSessions: number;
}

export interface FunnelStep {
  label: string;
  kind: string;
  count: number;
  /** percentage of `totalLeads` that reached this step, 0..100 */
  pct: number;
}

export interface FunnelResult {
  scope: ActivityScope;
  totalLeads: number;
  steps: FunnelStep[];
}

/**
 * Lead-row shape returned from `getLeadsForExport` and fed straight into
 * `buildLeadCsv`. Pulls de-normalised aggregates plus the contextual run /
 * campaign names so the CSV consumer doesn't have to do a second roundtrip.
 */
export interface ExportLeadRow {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  slug: string | null;
  leadStatus: string;
  temperature: LeadTemperature;
  lastActivityAt: string | null;
  pageViews: number;
  watchTimeSec: number;
  ctaClicks: number;
  runId: string;
  runName: string;
  campaignId: string;
  campaignName: string;
}
