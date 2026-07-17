import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { domainRenderProfiles } from "@/lib/db/schema";

/**
 * Telemetrie-Upsert nach jedem Website-Capture (Schicht 5 des
 * Clean-Render-Systems). Nie throwend — Telemetrie darf niemals eine
 * Video-Pipeline scheitern lassen.
 */
export async function recordDomainRenderResult(params: {
  hostname: string;
  platform: string;
  cmp: string;
  resolvedBy: string;
  success: boolean;
  problem?: string | null;
}): Promise<void> {
  const hostname = params.hostname.replace(/^www\./, "").toLowerCase();
  if (!hostname) return;
  try {
    await db
      .insert(domainRenderProfiles)
      .values({
        hostname,
        platform: params.platform,
        cmp: params.cmp,
        resolvedBy: params.resolvedBy,
        successCount: params.success ? 1 : 0,
        failCount: params.success ? 0 : 1,
        lastProblem: params.problem ?? null,
      })
      .onConflictDoUpdate({
        target: domainRenderProfiles.hostname,
        set: {
          platform: sql`CASE WHEN excluded.platform <> 'unknown' THEN excluded.platform ELSE ${domainRenderProfiles.platform} END`,
          cmp: sql`CASE WHEN excluded.cmp <> 'unknown' THEN excluded.cmp ELSE ${domainRenderProfiles.cmp} END`,
          resolvedBy: sql`excluded.resolved_by`,
          successCount: sql`${domainRenderProfiles.successCount} + excluded.success_count`,
          failCount: sql`${domainRenderProfiles.failCount} + excluded.fail_count`,
          lastProblem: sql`excluded.last_problem`,
          lastCaptureAt: sql`now()`,
        },
      });
  } catch (err) {
    console.warn(
      `[domain-render-profiles] upsert failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
