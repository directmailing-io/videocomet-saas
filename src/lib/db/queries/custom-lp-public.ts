/**
 * Public-side lookups for the Custom-LP sandbox renderer (`/cv/<slug>`).
 *
 * Responsibility: resolve a public-facing slug (optionally scoped to a
 * Custom-Domain) to the EXACT version that should be served. Single DB
 * round-trip via a chained join so the hot path stays cheap.
 *
 * Lookup chain:
 *   leads (slug, optional domainId)
 *     → runs  (campaignId, customLpVersionId)
 *       → campaigns (customLpTemplateId)
 *         → customLpTemplates (activeVersionId, fallback)
 *           → customLpVersions (storagePath, entryHtml, annotations)
 *
 * Version-pick precedence (per spec):
 *   1. runs.customLpVersionId  (immutable per-run pin)
 *   2. customLpTemplates.activeVersionId  (template default)
 *   3. NULL → 404
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  customLpTemplates,
  customLpVersions,
  leads,
  runs,
} from "@/lib/db/schema";

/** Resolved context: everything the sandbox renderer needs in one bundle. */
export interface CustomLpPublicContext {
  leadId: string;
  leadData: Record<string, string>;
  versionId: string;
  storagePath: string;
  entryHtml: string;
  annotations: Record<string, unknown> | null;
}

/**
 * Resolve the Custom-LP context for a slug served on `lp.videocomet.de`
 * (no custom-domain scope). The slug must be globally unique — leads
 * without a Custom-Domain pin live in the global slug namespace.
 */
export async function getCustomLpContextBySlug(
  slug: string,
): Promise<CustomLpPublicContext | null> {
  const row = await db
    .select({
      leadId: leads.id,
      leadData: leads.data,
      customLpTemplateId: campaigns.customLpTemplateId,
      pinnedVersionId: runs.customLpVersionId,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .leftJoin(
      customLpTemplates,
      eq(customLpTemplates.id, campaigns.customLpTemplateId),
    )
    .where(eq(leads.slug, slug))
    .limit(1);

  return materialise(row[0]);
}

/**
 * Resolve the Custom-LP context for a slug served on a customer
 * Custom-Domain. Slug + domainId together form the unique key in that
 * namespace.
 *
 * Note: v1 of the Custom-LP feature does NOT actually serve via
 * Custom-Domains (only via `lp.videocomet.de`). This helper exists so
 * future v2 work can flip a single flag in the middleware without
 * changing the public-lookup API.
 */
export async function getCustomLpContextBySlugAndDomain(
  slug: string,
  domainId: string,
): Promise<CustomLpPublicContext | null> {
  const row = await db
    .select({
      leadId: leads.id,
      leadData: leads.data,
      customLpTemplateId: campaigns.customLpTemplateId,
      pinnedVersionId: runs.customLpVersionId,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .leftJoin(
      customLpTemplates,
      eq(customLpTemplates.id, campaigns.customLpTemplateId),
    )
    .where(and(eq(leads.slug, slug), eq(leads.domainId, domainId)))
    .limit(1);

  return materialise(row[0]);
}

/**
 * Picks the correct version row (pinned vs active) and fetches its
 * `storagePath / entryHtml / annotations`. Returns null if no Custom-LP
 * template is bound OR neither a pinned nor an active version exists.
 */
async function materialise(
  row:
    | {
        leadId: string;
        leadData: Record<string, string>;
        customLpTemplateId: string | null;
        pinnedVersionId: string | null;
        activeVersionId: string | null;
      }
    | undefined,
): Promise<CustomLpPublicContext | null> {
  if (!row) return null;
  if (!row.customLpTemplateId) return null;

  // Precedence: pinned > active.
  const versionId = row.pinnedVersionId ?? row.activeVersionId;
  if (!versionId) return null;

  const [version] = await db
    .select({
      id: customLpVersions.id,
      storagePath: customLpVersions.storagePath,
      entryHtml: customLpVersions.entryHtml,
      annotations: customLpVersions.annotations,
    })
    .from(customLpVersions)
    .where(eq(customLpVersions.id, versionId))
    .limit(1);

  if (!version) return null;

  return {
    leadId: row.leadId,
    leadData: row.leadData,
    versionId: version.id,
    storagePath: version.storagePath,
    entryHtml: version.entryHtml,
    annotations: (version.annotations as Record<string, unknown> | null) ?? null,
  };
}
