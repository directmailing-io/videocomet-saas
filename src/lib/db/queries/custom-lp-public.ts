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

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  customLpTemplates,
  customLpVersions,
  leads,
  runs,
} from "@/lib/db/schema";
import { pickBunnyMp4Fallback } from "@/lib/bunny/mp4-fallback";

/** Resolved context: everything the sandbox renderer needs in one bundle. */
export interface CustomLpPublicContext {
  leadId: string;
  leadData: Record<string, string>;
  /** HLS-Playlist-URL (Safari nativ, andere via HLS.js). */
  videoUrl: string | null;
  /** MP4-Fallback aus dem gleichen Bunny-Pfad — broad-compat. */
  videoMp4Url: string | null;
  /** Poster für den HTML5-Video-Player (vor Play). */
  thumbnailUrl: string | null;
  /**
   * Aspect-Ratio des Lead-Videos. Wird vom Custom-LP-Renderer in eine
   * `--vc-video-aspect`-CSS-Variable übersetzt, damit Custom-Templates
   * Portrait/Landscape/Square per CSS-Variable nutzen können. `null` =
   * Paket A hat die Spalte noch nicht populiert → Renderer fällt auf
   * `16/9` zurück.
   */
  videoOrientation: "landscape" | "portrait" | "square" | null;
  versionId: string;
  storagePath: string;
  entryHtml: string;
  annotations: Record<string, unknown> | null;
}

/**
 * Resolve the Custom-LP context for a slug served on the platform default
 * host (`lp.videocomet.de` / `app.videocomet.de`).
 *
 * TENANT-SAFETY: only matches leads with `domain_id IS NULL`. Leads pinned
 * to a customer Custom-Domain MUST stay scoped to that domain — otherwise
 * a cross-tenant slug collision (same slug on default domain vs. custom
 * domain) would leak the wrong tenant's Custom-LP to a default-host visit.
 */
export async function getCustomLpContextBySlugForDefaultDomain(
  slug: string,
): Promise<CustomLpPublicContext | null> {
  const row = await db
    .select({
      leadId: leads.id,
      leadData: leads.data,
      videoUrl: leads.videoUrl,
      thumbnailUrl: leads.thumbnailUrl,
      // Aus Paket A (Migration 0015): vom Bunny-Resolver beim Finalize
      // gepinnte MP4-URL + Orientation. `videoMp4Url` ist die Source of
      // Truth — fehlt sie (Bestand vor Paket H), fallen wir im
      // `materialise()` auf die Bunny-Replacement-Heuristik zurueck.
      videoMp4Url: leads.videoMp4Url,
      videoOrientation: leads.videoOrientation,
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
    .where(and(eq(leads.slug, slug), isNull(leads.domainId)))
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
      videoUrl: leads.videoUrl,
      thumbnailUrl: leads.thumbnailUrl,
      videoMp4Url: leads.videoMp4Url,
      videoOrientation: leads.videoOrientation,
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
        videoUrl: string | null;
        thumbnailUrl: string | null;
        videoMp4Url: string | null;
        videoOrientation: string | null;
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

  // MP4-URL-Resolution (Paket D/H persistiert die finale MP4-URL auf
  // `leads.videoMp4Url`, sobald die Pipeline-Stage `bunnyUpload` durch ist):
  //   1) Wenn `leads.videoMp4Url` gesetzt ist → das ist die Source of Truth.
  //   2) Sonst: Backward-Compat — `pickBunnyMp4Fallback` transformiert den
  //      Bunny-HLS-Playlist-Pfad in einen progressiven MP4-Pfad. Da wir hier
  //      keine `availableResolutions` joinen, nutzt der Helper den safen
  //      480p-Default (existiert auch fuer Portrait-Quellen — anders als
  //      das frueher hardcoded 720p, das fuer 404×720-Sources einen 404 lief).
  const videoMp4Url =
    row.videoMp4Url ??
    (row.videoUrl ? pickBunnyMp4Fallback(row.videoUrl) : null);

  // Orientation als string in DB; auf erlaubtes Tupel verengen.
  const videoOrientation =
    row.videoOrientation === "landscape" ||
    row.videoOrientation === "portrait" ||
    row.videoOrientation === "square"
      ? row.videoOrientation
      : null;

  return {
    leadId: row.leadId,
    leadData: row.leadData,
    videoUrl: row.videoUrl,
    videoMp4Url,
    thumbnailUrl: row.thumbnailUrl,
    videoOrientation,
    versionId: version.id,
    storagePath: version.storagePath,
    entryHtml: version.entryHtml,
    annotations: (version.annotations as Record<string, unknown> | null) ?? null,
  };
}
