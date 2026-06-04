/**
 * Stage 5: Landing-page row creation.
 *
 * Persists the lead's slug and page URL. The slug is generated via the
 * centralized `generateSlug()` engine from `@/lib/slug`, which:
 *   - Renders the campaign's slug-template against the lead's CSV data
 *     (with German/English field aliases like firstName ↔ Vorname)
 *   - Falls back to `{firstName}-{lastName}` when no template is set
 *   - Guarantees uniqueness via an availability callback (scoped to either
 *     the campaign's custom-domain OR the default app.videocomet.de space)
 *   - Adds a 4-hex suffix on collision (same shape as before)
 *
 * The page URL respects three orthogonal settings, in this precedence:
 *   1. Custom domain active                         → https://<hostname>/<slug>
 *   2. Custom-LP active on the run (customLpVersionId pinned)
 *                                                   → https://lp.videocomet.de/<slug>
 *   3. Default                                      → https://app.videocomet.de/v/<slug>
 *
 * (1) wins over (2) so a customer who has both a Custom-Domain AND a Custom-LP
 * still gets their white-label hostname. The Custom-Domain Traefik-Router
 * forwards to the App; the App's middleware then re-routes to the Custom-LP
 * renderer via the same path it would on `lp.videocomet.de`.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, userDomains } from "@/lib/db/schema";
import { generateSlug } from "@/lib/slug";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";

export interface LandingPageInput {
  leadId: string;
  appUrl: string;
  /** Raw lead-data row (CSV) — feeds the slug-template renderer. */
  leadData: Record<string, string | null | undefined>;
  /** Lead's row index in the run — used as deterministic fallback. */
  rowIndex: number;
  /** Slug template from the campaign, e.g. `{firstName}-{lastName}`. */
  slugTemplate: string | null;
  /**
   * Optionales Placeholder-Mapping aus `runs.column_mapping.placeholderMapping`.
   * Wenn gesetzt, gewinnt es im Slug-Template vor der Alias-Logik (z. B.
   * wenn der User explizit `firstName` → `Anrede` gemappt hat).
   */
  placeholderMapping?: PlaceholderMapping | LegacyMapping;
  /** Optional custom-domain id (the campaign chose a custom domain). */
  domainId: string | null;
  /**
   * Pinned Custom-LP version id (snapshotted on `runs` at run-start). When
   * set AND the campaign has no active custom-domain, the public page URL
   * routes via the Custom-LP sandbox host instead of `/v/<slug>`.
   */
  customLpVersionId: string | null;
  /**
   * Sandbox host for Custom-LP delivery (e.g. `lp.videocomet.de`). Resolved
   * from the worker's `SANDBOX_LP_HOST` env at call time.
   */
  customLpHost: string;
}

export interface LandingPageOutput {
  slug: string;
  pageUrl: string;
}

/**
 * Slug-Verfügbarkeits-Check, korrekt scoped:
 *   - Custom-Domain: unique innerhalb dieser domain_id (partial unique-Index)
 *   - Default:       unique innerhalb (domain_id IS NULL) — Backward-Compat
 * Schliesst den eigenen Lead aus, damit ein Retry idempotent ist.
 */
async function buildAvailabilityCheck(
  leadId: string,
  domainId: string | null,
): Promise<(candidate: string) => Promise<boolean>> {
  return async (candidate: string) => {
    const where = domainId
      ? and(eq(leads.slug, candidate), eq(leads.domainId, domainId))
      : and(eq(leads.slug, candidate), isNull(leads.domainId));
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(where)
      .limit(1);
    if (!row) return true;
    return row.id === leadId;
  };
}

/**
 * Resolves the hostname to use for the page URL. If the campaign's domain
 * is set AND still active, use it; otherwise fall back to the default app
 * URL. This silently degrades when a customer deletes a domain that a
 * running campaign still references (variant B per product decision).
 */
async function resolvePageUrl(
  domainId: string | null,
  defaultAppUrl: string,
  slug: string,
  customLpVersionId: string | null,
  customLpHost: string,
): Promise<{ pageUrl: string; effectiveDomainId: string | null }> {
  if (domainId) {
    const [d] = await db
      .select({ id: userDomains.id, hostname: userDomains.hostname, status: userDomains.status })
      .from(userDomains)
      .where(eq(userDomains.id, domainId))
      .limit(1);
    if (d && d.status === "active") {
      return {
        pageUrl: `https://${d.hostname}/${slug}`,
        effectiveDomainId: d.id,
      };
    }
  }
  if (customLpVersionId) {
    return {
      pageUrl: `https://${customLpHost}/${slug}`,
      effectiveDomainId: null,
    };
  }
  return {
    pageUrl: `${defaultAppUrl.replace(/\/+$/, "")}/v/${slug}`,
    effectiveDomainId: null,
  };
}

/**
 * Generates a unique slug, persists it on the lead row, and returns the
 * full public URL.
 */
export async function runLandingPageCreate(
  input: LandingPageInput,
): Promise<LandingPageOutput> {
  const isAvailable = await buildAvailabilityCheck(input.leadId, input.domainId);

  const slug = await generateSlug({
    template: input.slugTemplate,
    leadData: input.leadData,
    mapping: input.placeholderMapping,
    isAvailable,
    fallbackId: input.rowIndex,
  });

  const { pageUrl, effectiveDomainId } = await resolvePageUrl(
    input.domainId,
    input.appUrl,
    slug,
    input.customLpVersionId,
    input.customLpHost,
  );

  await updateLeadStatus(input.leadId, { slug });
  // Persist the effectiveDomainId on the lead so the public router can
  // resolve `<hostname>/<slug>` later. If the campaign's domain has been
  // deleted between scheduling and pipeline execution, we degrade to
  // domain_id=NULL (default URL) instead of crashing.
  await db
    .update(leads)
    .set({ domainId: effectiveDomainId ?? sql`NULL` })
    .where(eq(leads.id, input.leadId));

  return { slug, pageUrl };
}
