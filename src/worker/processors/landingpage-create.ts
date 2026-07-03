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

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  userDomains,
  LEADS_CAMPAIGN_DEFAULT_SLUG_UQ,
  LEADS_CAMPAIGN_CUSTOM_SLUG_UQ,
  LEGACY_LEADS_DEFAULT_SLUG_UQ,
  LEGACY_LEADS_CUSTOM_SLUG_UQ,
} from "@/lib/db/schema";
import { generateSlug, slugHexSuffix } from "@/lib/slug";
import { findSlugInCampaign, updateLeadStatus } from "@/lib/db/queries/leads";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";

export interface LandingPageInput {
  leadId: string;
  /**
   * Campaign-ID des Leads. Wird benötigt, weil die Slug-Eindeutigkeit ab
   * Migration 0014 campaign-scoped ist — `(campaignId, slug)` bzw.
   * `(campaignId, domainId, slug)` für Custom-Domain-Namespace.
   */
  campaignId: string;
  /**
   * Optionaler Tenant-Suffix aus `campaigns.slug_suffix`. Wird IMMER an den
   * generierten Slug angehängt (z.B. `simon-krempel-test`). Format
   * `^[a-z0-9-]{1,32}$` — DB-CHECK-Constraint hält das gerade.
   */
  campaignSlugSuffix: string | null;
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
 * Slug-Verfügbarkeits-Check, korrekt scoped auf `(campaignId, [domainId,] slug)`:
 *   - Custom-Domain: unique innerhalb `(campaignId, domain_id, slug)` (partial Index)
 *   - Default:       unique innerhalb `(campaignId, slug)` mit `domain_id IS NULL`
 * Schliesst den eigenen Lead aus, damit ein Retry idempotent ist.
 *
 * WICHTIG: `effectiveDomainId` MUSS der EFFEKTIVE Wert sein, der spaeter in
 * der DB landet (also `null` wenn die Custom-Domain noch nicht active ist).
 * Sonst checken wir im falschen Namespace.
 *
 * Ab Migration 0014 ist Slug NICHT mehr global eindeutig — derselbe
 * `simon-krempel` darf in drei unterschiedlichen Kampagnen leben. Wir
 * scopen den Existenz-Check daher zusätzlich auf `campaignId`.
 */
function buildAvailabilityCheck(
  leadId: string,
  campaignId: string,
  effectiveDomainId: string | null,
): (candidate: string) => Promise<boolean> {
  return async (candidate: string) => {
    const hit = await findSlugInCampaign(
      campaignId,
      candidate,
      effectiveDomainId,
      leadId,
    );
    return hit === null;
  };
}

/**
 * Loest die effektive `domain_id` BEVOR der Slug generiert wird — damit
 * Availability-Check und persistierter Wert garantiert im selben Namespace
 * landen.
 *
 * Regeln (parallel zu `resolvePageUrl`):
 *  - Kampagne hat eine `domainId` UND die Domain ist `active` → diese ID
 *  - Sonst (keine Custom-Domain, Domain geloescht, Domain noch nicht aktiv)
 *    → null (Default-Namespace, app.videocomet.de)
 */
async function resolveEffectiveDomainId(
  domainId: string | null,
): Promise<string | null> {
  if (!domainId) return null;
  const [d] = await db
    .select({ id: userDomains.id, status: userDomains.status })
    .from(userDomains)
    .where(eq(userDomains.id, domainId))
    .limit(1);
  if (d && d.status === "active") return d.id;
  return null;
}

/**
 * Postgres-Fehler-Detector fuer Slug-UNIQUE-Verletzungen. Wir matchen sowohl
 * den Default- als auch den Custom-Domain-Partial-Index, damit Retries
 * konsistent funktionieren.
 *
 * Wir prüfen die neuen campaign-scoped Index-Namen (Migration 0014) UND die
 * Legacy-Namen (Pre-0014). Letzteres ist Bestandsschutz für Dev-Branches
 * oder Envs, die noch nicht migriert wurden — sonst würde der Race-Retry-
 * Pfad dort still kaputt sein.
 */
const SLUG_UNIQUE_CONSTRAINTS: ReadonlySet<string> = new Set([
  LEADS_CAMPAIGN_DEFAULT_SLUG_UQ,
  LEADS_CAMPAIGN_CUSTOM_SLUG_UQ,
  LEGACY_LEADS_DEFAULT_SLUG_UQ,
  LEGACY_LEADS_CUSTOM_SLUG_UQ,
]);

function isSlugUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // postgres-js wirft via DrizzleQueryError; der echte pg-Error sitzt als
  // `cause` darauf. Wir checken beide Ebenen.
  const inner =
    (err as { cause?: unknown }).cause && typeof (err as { cause?: unknown }).cause === "object"
      ? (err as { cause: Record<string, unknown> }).cause
      : (err as Record<string, unknown>);
  if (inner.code !== "23505") return false;
  const constraint = String(inner.constraint_name ?? "");
  return SLUG_UNIQUE_CONSTRAINTS.has(constraint);
}

/**
 * Generates a unique slug, persists it on the lead row, and returns the
 * full public URL.
 *
 * Schritte (in dieser Reihenfolge wichtig):
 *  1. Effektive `domain_id` AUFLÖSEN — gleicher Wert wie spaeter im UPDATE
 *  2. `isAvailable` im EFFECTIVE-Namespace bauen
 *  3. Slug generieren (Suffix bei Konflikt)
 *  4. URL bauen
 *  5. ATOMARER Update: slug + domain_id in EINEM SQL-Statement
 *  6. Bei seltener Race-Condition (concurrent INSERT desselben Slugs):
 *     Hex-Suffix retry, bis zu 4×
 */
export async function runLandingPageCreate(
  input: LandingPageInput,
): Promise<LandingPageOutput> {
  // 1) Effektive Domain — gleicher Wert in `isAvailable` UND im UPDATE.
  const effectiveDomainId = await resolveEffectiveDomainId(input.domainId);

  // 2) Availability-Check im KORREKTEN Namespace (campaign-scoped + optional
  //    domain-scoped, siehe Migration 0014).
  const isAvailable = buildAvailabilityCheck(
    input.leadId,
    input.campaignId,
    effectiveDomainId,
  );

  // 3) Slug aus Template + Daten generieren. Seit 2026-07-03 `always-hex` —
  //    jeder Slug bekommt IMMER einen 4-char HEX-Suffix, auch beim ersten
  //    Vorkommen. Verhindert Cross-Campaign-Slug-Collision auf Custom-Domains
  //    (Bug: video.digispace.at/markus-oberdacher lieferte falsches Video
  //    wenn zwei Kampagnen desselben Users denselben Lead-Namen enthielten).
  //    Der optionale `campaignSlugSuffix` bleibt zusaetzlich moeglich.
  let slug = await generateSlug({
    template: input.slugTemplate,
    leadData: input.leadData,
    mapping: input.placeholderMapping,
    isAvailable,
    fallbackId: input.rowIndex,
    campaignSlugSuffix: input.campaignSlugSuffix,
    collisionStrategy: "always-hex",
  });

  // 4) Atomarer Update mit Retry-Safety-Net gegen Race-Conditions (zwei
  //    Worker, die exakt denselben Slug-Kandidaten zur gleichen Zeit checken).
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await updateLeadStatus(input.leadId, {
        slug,
        domainId: effectiveDomainId,
      });
      const pageUrl = buildPageUrl({
        effectiveDomainId,
        appUrl: input.appUrl,
        slug,
        customLpVersionId: input.customLpVersionId,
        customLpHost: input.customLpHost,
        domainHostname: await resolveActiveDomainHostname(effectiveDomainId),
      });
      return { slug, pageUrl };
    } catch (err) {
      if (!isSlugUniqueViolation(err) || attempt === MAX_RETRIES) throw err;
      // Race-Condition: neuer Suffix, retry.
      // eslint-disable-next-line no-console
      console.warn(
        `[landingpage-create] slug "${slug}" conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying with hex suffix`,
      );
      slug = `${slug}-${slugHexSuffix()}`;
    }
  }
  // Unerreichbar (Loop wirft oder returnt), aber TS will einen Return.
  throw new Error("[landingpage-create] unreachable retry exit");
}

/** Liefert den Hostnamen einer aktiven Custom-Domain, sonst null. */
async function resolveActiveDomainHostname(
  effectiveDomainId: string | null,
): Promise<string | null> {
  if (!effectiveDomainId) return null;
  const [d] = await db
    .select({ hostname: userDomains.hostname })
    .from(userDomains)
    .where(eq(userDomains.id, effectiveDomainId))
    .limit(1);
  return d?.hostname ?? null;
}

/**
 * Reine URL-Konstruktion ohne DB-Roundtrip — die effektive Domain wird
 * vom Caller schon resolved übergeben.
 */
function buildPageUrl(args: {
  effectiveDomainId: string | null;
  appUrl: string;
  slug: string;
  customLpVersionId: string | null;
  customLpHost: string;
  domainHostname: string | null;
}): string {
  if (args.effectiveDomainId && args.domainHostname) {
    return `https://${args.domainHostname}/${args.slug}`;
  }
  if (args.customLpVersionId) {
    return `https://${args.customLpHost}/${args.slug}`;
  }
  return `${args.appUrl.replace(/\/+$/, "")}/v/${args.slug}`;
}
