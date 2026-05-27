/**
 * Stage 5: Landing-page row creation.
 *
 * Persists the lead's slug and page URL. Slug is generated via the global
 * slugify helper (UMLAUTS→ASCII transliteration + 4-hex suffix). On the
 * extremely unlikely event of a collision we regenerate up to 5 times.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";
import { updateLeadStatus } from "@/lib/db/queries/leads";

export interface LandingPageInput {
  leadId: string;
  appUrl: string;
  /**
   * Pretty name to feed into the slugifier (typically the lead's company /
   * full name). If empty we fall back to `lead-<id>`.
   */
  prettyName: string;
}

export interface LandingPageOutput {
  slug: string;
  pageUrl: string;
}

async function isSlugFree(slug: string, excludeLeadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.slug, slug)))
    .limit(1);
  if (!row) return true;
  return row.id === excludeLeadId;
}

/**
 * Generates a unique slug, persists it on the lead row, and returns the
 * full public URL.
 */
export async function runLandingPageCreate(
  input: LandingPageInput,
): Promise<LandingPageOutput> {
  const base = input.prettyName?.trim() ? input.prettyName : `lead ${input.leadId.slice(0, 6)}`;

  let slug = slugify(base, true);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isSlugFree(slug, input.leadId)) break;
    slug = slugify(base, true);
  }

  const pageUrl = `${input.appUrl.replace(/\/+$/, "")}/v/${slug}`;
  await updateLeadStatus(input.leadId, { slug });
  return { slug, pageUrl };
}
