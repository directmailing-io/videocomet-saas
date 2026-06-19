/**
 * CRM-Sync Worker Processor.
 *
 * Picks up a debounced job from the `crm-sync` BullMQ queue and pushes the
 * current state of one lead to the configured external CRM (HubSpot,
 * Salessuite, or Close). The job ONLY carries identifiers — the worker
 * re-reads the freshest aggregate columns (`lead.lastViewedAt`, etc.) so
 * the value the CRM sees reflects all events absorbed during the 30s
 * debounce window, not just the one that originally enqueued.
 *
 * Flow:
 *   1. Load lead + run + campaign + campaign_crm_settings + integration.
 *      Skip (log row) if any are missing OR settings.enabled=false OR
 *      integration is soft-disabled.
 *   2. Decrypt the API key (AES-256-GCM, master in CRM_KEY_SECRET).
 *   3. Resolve the match value (email/phone) from lead.data per
 *      settings.leadMatch fallback list. Skip if no value found.
 *   4. `provider.findContactByField(...)`. Skip if no contact, log warn
 *      on multi-match (we push to ALL matches — safer than guessing).
 *   5. Build the payload from settings.fieldMapping + enabledEvents.
 *      Omit keys whose value is null/undefined.
 *   6. For EACH matched contact: `provider.updateContactFields(...)` and
 *      log the result. Auth errors (401/403) → soft-disable the
 *      integration so the next 1000 events from this campaign don't
 *      hammer a known-broken connection. 5xx + 429 throw → BullMQ
 *      retries with the queue's exponential backoff. Other 4xx (e.g.
 *      400 bad-field-name) don't throw — retries won't help, the user
 *      needs to fix the field mapping in the UI.
 *
 * Audit log: every HTTP attempt produces ONE `crm_event_log` row with
 * `http_status`, `request_body`, `response_body`, `contact_id`. Support
 * uses this to answer "why didn't my lead appear?" — the 30-day purge
 * keeps the table bounded (see `crm-log-purge.ts`).
 */

import type { Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaignCrmSettings,
  campaigns,
  crmEventLog,
  crmIntegrations,
  leads,
  runs,
  userDomains,
} from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/crm/crypto";
import { getCrmProvider } from "@/lib/crm/registry";
import { resolveLeadMatchValue, type LeadMatchRule } from "@/lib/crm/match";
import { CrmHttpError } from "@/lib/crm/types";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import type { CrmSyncJob, CrmSyncEventKind } from "../crm-queue";

const APP_URL = process.env.APP_URL ?? "https://app.videocomet.de";

/**
 * Outcome categories we record in `crm_event_log.error_message` when we
 * stop early without making an HTTP call. Keeping the values short +
 * stable so support queries can `WHERE error_message = 'skipped:no_match_value'`.
 */
type SkipReason =
  | "skipped:settings_missing"
  | "skipped:integration_disabled"
  | "skipped:no_match_value"
  | "skipped:contact_not_found";

/**
 * Insert a single audit row. Wrapped in its own try/catch so a logging
 * failure (e.g. DB blip) never aborts the actual CRM-push work.
 */
async function logCrmEvent(opts: {
  campaignId: string;
  leadId: string | null;
  integrationId: string | null;
  eventKind: string;
  lookupField?: string | null;
  lookupValue?: string | null;
  contactId?: string | null;
  httpStatus?: number | null;
  requestBody?: unknown;
  responseBody?: unknown;
  errorMessage?: string | null;
  attempt?: number;
}): Promise<void> {
  try {
    await db.insert(crmEventLog).values({
      campaignId: opts.campaignId,
      leadId: opts.leadId,
      integrationId: opts.integrationId,
      eventKind: opts.eventKind,
      lookupField: opts.lookupField ?? null,
      lookupValue: opts.lookupValue ?? null,
      contactId: opts.contactId ?? null,
      httpStatus: opts.httpStatus ?? null,
      requestBody: opts.requestBody ?? null,
      responseBody: opts.responseBody ?? null,
      errorMessage: opts.errorMessage ?? null,
      attempt: opts.attempt ?? 1,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[crm:sync] failed to write crm_event_log row for lead=${opts.leadId ?? "?"}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

interface FieldMappingShape {
  page_view?: string;
  video_play?: string;
  cta_click?: string;
  campaign_name?: string;
  run_name?: string;
  page_url?: string;
  [k: string]: string | undefined;
}

/**
 * Compose the `{crmFieldKey → value}` map we'll POST to the provider.
 * Only includes fields where (a) the customer mapped a CRM-target key
 * AND (b) we have a non-null/empty value to write. Empty maps are
 * intentionally returned — the caller decides whether to short-circuit
 * (we currently still call the provider; some providers want a "touched"
 * call to bump activity timestamps even with no fields).
 */
function buildPayload(
  fieldMapping: FieldMappingShape,
  enabledEvents: CrmSyncEventKind[],
  lead: {
    lastViewedAt: Date | null;
    lastCtaAt: Date | null;
  },
  jobTsIso: string,
  campaignName: string,
  runName: string,
  pageUrl: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};

  const setIfMapped = (crmKey: string | undefined, value: string | null | undefined) => {
    if (!crmKey) return;
    if (typeof value !== "string" || value.length === 0) return;
    out[crmKey] = value;
  };

  if (enabledEvents.includes("page_view")) {
    setIfMapped(
      fieldMapping.page_view,
      lead.lastViewedAt ? lead.lastViewedAt.toISOString() : jobTsIso,
    );
  }
  if (enabledEvents.includes("video_play")) {
    // The leads schema doesn't carry a dedicated `lastVideoPlayAt` column
    // today — `playCount` + the events table track it. Until that column
    // lands, fall back to the job's originating timestamp; the field
    // mapping still gets touched on every video_play burst.
    setIfMapped(fieldMapping.video_play, jobTsIso);
  }
  if (enabledEvents.includes("cta_click")) {
    setIfMapped(
      fieldMapping.cta_click,
      lead.lastCtaAt ? lead.lastCtaAt.toISOString() : jobTsIso,
    );
  }

  // Static / per-lead metadata fields.
  setIfMapped(fieldMapping.campaign_name, `${campaignName} – ${runName}`);
  setIfMapped(fieldMapping.run_name, runName);
  if (pageUrl) setIfMapped(fieldMapping.page_url, pageUrl);

  return out;
}

/**
 * Parses `settings.leadMatch` defensively. The JSONB column is typed as
 * `Record<string, unknown>` at the schema level (Phase-1 stub); we narrow
 * it here. Accepts both `{ rules: [...] }` AND a bare `[...]` payload so
 * historical Phase-1 inserts still work.
 */
function parseLeadMatchRules(leadMatch: unknown): LeadMatchRule[] {
  if (Array.isArray(leadMatch)) {
    return leadMatch.filter(
      (r): r is LeadMatchRule =>
        !!r &&
        typeof r === "object" &&
        typeof (r as { source?: unknown }).source === "string" &&
        ((r as { target?: unknown }).target === "email" ||
          (r as { target?: unknown }).target === "phone"),
    );
  }
  if (leadMatch && typeof leadMatch === "object") {
    const rules = (leadMatch as { rules?: unknown }).rules;
    if (Array.isArray(rules)) return parseLeadMatchRules(rules);
  }
  return [];
}

function parseEnabledEvents(value: unknown): CrmSyncEventKind[] {
  if (!Array.isArray(value)) return [];
  const out: CrmSyncEventKind[] = [];
  for (const v of value) {
    if (v === "page_view" || v === "video_play" || v === "cta_click") {
      out.push(v);
    }
  }
  return out;
}

function parseFieldMapping(value: unknown): FieldMappingShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: FieldMappingShape = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Process one CRM-sync job. See module header for the full flow.
 * Throws ONLY on retryable conditions (5xx, 429); BullMQ then retries
 * with the queue's exponential backoff (30s → 60s → 120s → 240s).
 */
export async function processCrmSyncJob(job: Job<CrmSyncJob>): Promise<void> {
  const { leadId, kind, ts } = job.data;
  const attempt = job.attemptsMade + 1;

  // ── 1. Load all the rows we need in a single round-trip ────────────
  const [row] = await db
    .select({
      // lead
      leadId: leads.id,
      runId: leads.runId,
      campaignId: leads.campaignId,
      leadData: leads.data,
      leadSlug: leads.slug,
      leadDomainId: leads.domainId,
      lastViewedAt: leads.lastViewedAt,
      lastCtaAt: leads.lastCtaAt,
      // run
      runName: runs.name,
      // campaign
      campaignName: campaigns.name,
      // settings
      crmIntegrationId: campaignCrmSettings.crmIntegrationId,
      enabled: campaignCrmSettings.enabled,
      leadMatch: campaignCrmSettings.leadMatch,
      enabledEvents: campaignCrmSettings.enabledEvents,
      fieldMapping: campaignCrmSettings.fieldMapping,
      // integration
      provider: crmIntegrations.provider,
      apiKeyEncrypted: crmIntegrations.apiKeyEncrypted,
      integrationDisabledAt: crmIntegrations.disabledAt,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
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

  // Settings missing OR campaign was deleted OR lead was hard-deleted.
  // We have nowhere to log to (no campaignId resolvable) when row is
  // truly empty — log to stdout and bail.
  if (!row) {
    // eslint-disable-next-line no-console
    console.warn(`[crm:sync] no row for lead=${leadId} kind=${kind}; skipping.`);
    return;
  }

  const skipBase = {
    campaignId: row.campaignId,
    leadId: row.leadId,
    integrationId: row.crmIntegrationId,
    eventKind: kind,
    attempt,
  };

  if (!row.enabled) {
    await logCrmEvent({
      ...skipBase,
      errorMessage: "skipped:settings_missing" satisfies SkipReason,
    });
    return;
  }
  if (row.integrationDisabledAt) {
    await logCrmEvent({
      ...skipBase,
      errorMessage: "skipped:integration_disabled" satisfies SkipReason,
    });
    return;
  }

  // ── 2. Decrypt API key ─────────────────────────────────────────────
  let apiKey: string;
  try {
    apiKey = decryptApiKey(row.apiKeyEncrypted);
  } catch (err) {
    await logCrmEvent({
      ...skipBase,
      errorMessage: `decrypt_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // ── 3. Resolve match value via settings.leadMatch ──────────────────
  const rules = parseLeadMatchRules(row.leadMatch);
  const matchResult = resolveLeadMatchValue(
    (row.leadData as Record<string, string>) ?? {},
    rules,
  );
  if (!matchResult) {
    await logCrmEvent({
      ...skipBase,
      errorMessage: "skipped:no_match_value" satisfies SkipReason,
    });
    return;
  }

  // ── 4. Provider lookup ─────────────────────────────────────────────
  const provider = getCrmProvider(row.provider);
  let contacts: Awaited<ReturnType<typeof provider.findContactByField>>;
  try {
    contacts = await provider.findContactByField(
      apiKey,
      matchResult.target,
      matchResult.value,
    );
  } catch (err) {
    // Lookup-Phase auth failure → mark integration disabled (same
    // policy as updateContactFields below). Anything else is logged +
    // potentially retried.
    if (err instanceof CrmHttpError) {
      await handleHttpFailure({
        ...skipBase,
        lookupField: matchResult.target,
        lookupValue: matchResult.value,
        err,
      });
      return;
    }
    // Non-HTTP exception — let BullMQ retry.
    throw err;
  }

  if (contacts.length === 0) {
    await logCrmEvent({
      ...skipBase,
      lookupField: matchResult.target,
      lookupValue: matchResult.value,
      errorMessage: "skipped:contact_not_found" satisfies SkipReason,
    });
    return;
  }

  // Resolve custom hostname for page URL — quick second query keyed on
  // lead.domainId. NULL = default app.videocomet.de path.
  let customHostname: string | null = null;
  if (row.leadDomainId) {
    const [d] = await db
      .select({ hostname: userDomains.hostname, status: userDomains.status })
      .from(userDomains)
      .where(and(eq(userDomains.id, row.leadDomainId), eq(userDomains.status, "active")))
      .limit(1);
    if (d) customHostname = d.hostname;
  }
  const pageUrl = buildLeadPublicUrl(
    {
      slug: row.leadSlug,
      customHostname,
      defaultAppUrl: APP_URL,
    },
    { absolute: true },
  );

  // ── 5. Build payload ──────────────────────────────────────────────
  const fieldMapping = parseFieldMapping(row.fieldMapping);
  const enabledEvents = parseEnabledEvents(row.enabledEvents);
  const jobTsIso = new Date(ts).toISOString();
  const payload = buildPayload(
    fieldMapping,
    enabledEvents,
    { lastViewedAt: row.lastViewedAt, lastCtaAt: row.lastCtaAt },
    jobTsIso,
    row.campaignName,
    row.runName,
    pageUrl,
  );

  // Multi-match warning. We push to ALL matches (the rep wants every
  // lookalike contact updated) and stash the extra IDs in the FIRST
  // contact's audit row's error_message for support visibility.
  const multiMatchSuffix =
    contacts.length > 1
      ? ` (multi_match: ${contacts.length} contacts, extra=[${contacts
          .slice(1)
          .map((c) => c.id)
          .join(",")}])`
      : "";

  // ── 6. Per-contact push with auth-failure auto-disable ─────────────
  let retryableThrown: CrmHttpError | null = null;
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]!;
    try {
      const res = await provider.updateContactFields(apiKey, contact.id, payload);
      await logCrmEvent({
        ...skipBase,
        lookupField: matchResult.target,
        lookupValue: matchResult.value,
        contactId: contact.id,
        httpStatus: 200,
        requestBody: payload,
        responseBody: res.raw ?? null,
        errorMessage: i === 0 && multiMatchSuffix ? `multi_match${multiMatchSuffix}` : null,
      });
    } catch (err) {
      if (err instanceof CrmHttpError) {
        const retry = await handleHttpFailure({
          ...skipBase,
          lookupField: matchResult.target,
          lookupValue: matchResult.value,
          contactId: contact.id,
          requestBody: payload,
          err,
        });
        if (retry) {
          // First retryable error wins; we still try the remaining
          // contacts so a 401 on contact #1 doesn't silently drop a
          // separate 200 push to contact #2. But we remember to throw
          // at the end so BullMQ retries the whole job (which will
          // hit BullMQ's jobId dedup on the next debounce window).
          retryableThrown = retryableThrown ?? err;
        }
      } else {
        // Non-HTTP error (network blip, JSON parse) — log + rethrow so
        // BullMQ retries.
        await logCrmEvent({
          ...skipBase,
          lookupField: matchResult.target,
          lookupValue: matchResult.value,
          contactId: contact.id,
          requestBody: payload,
          errorMessage: `non_http_error: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    }
  }

  if (retryableThrown) {
    throw retryableThrown;
  }
}

/**
 * Centralized HTTP-failure policy. Writes the audit row AND, on
 * 401/403, soft-disables the integration so the next batch of events
 * from that campaign skips immediately. Returns `true` if the caller
 * should treat this as retryable (5xx, 429); `false` for terminal
 * 4xx (bad-field-name, malformed payload, etc).
 */
async function handleHttpFailure(opts: {
  campaignId: string;
  leadId: string | null;
  integrationId: string | null;
  eventKind: string;
  attempt: number;
  lookupField?: string | null;
  lookupValue?: string | null;
  contactId?: string | null;
  requestBody?: unknown;
  err: CrmHttpError;
}): Promise<boolean> {
  const { err } = opts;
  await logCrmEvent({
    campaignId: opts.campaignId,
    leadId: opts.leadId,
    integrationId: opts.integrationId,
    eventKind: opts.eventKind,
    lookupField: opts.lookupField,
    lookupValue: opts.lookupValue,
    contactId: opts.contactId,
    httpStatus: err.status,
    requestBody: opts.requestBody,
    responseBody: err.body,
    errorMessage: err.message,
    attempt: opts.attempt,
  });

  if (err.status === 401 || err.status === 403) {
    // Soft-disable: future enqueue calls hit `disabledAt IS NOT NULL`
    // and skip without touching Redis. The user re-enables by
    // re-saving the integration with a fresh API key.
    if (opts.integrationId) {
      try {
        await db
          .update(crmIntegrations)
          .set({ disabledAt: new Date(), lastTestError: err.message })
          .where(eq(crmIntegrations.id, opts.integrationId));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[crm:sync] failed to soft-disable integration=${opts.integrationId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    return false;
  }

  if (err.status >= 500 || err.status === 429) {
    // Retryable: bubble up so BullMQ kicks the exponential backoff.
    return true;
  }

  // Other 4xx (400 bad-field-name, 404 contact-not-found-by-id, …):
  // retries won't help, the user needs to fix mapping in the UI.
  return false;
}
