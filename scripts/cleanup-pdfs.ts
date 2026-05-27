/**
 * PDF 7-day TTL cleanup.
 *
 * Cron-runnable script. Finds all leads with `pdf_url IS NOT NULL` AND
 * `pdf_expires_at < now()`, deletes the file from Bunny Edge Storage, and
 * clears the columns. Designed to be idempotent — if a Bunny DELETE fails
 * (e.g. 404 because it's already gone) we still NULL the DB columns.
 *
 * Run via: `npm run cleanup:pdfs`
 */

import "dotenv/config";
import { and, isNotNull, lt } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads } from "../src/lib/db/schema";
import { deleteFile } from "../src/lib/bunny/storage";
import { updateLeadStatus } from "../src/lib/db/queries/leads";

function extractRemotePathFromUrl(url: string): string | null {
  // URL form: https://<cdnHostname>/runs/<runId>/leads/<leadId>.pdf
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const rows = await db
    .select({
      id: leads.id,
      pdfUrl: leads.pdfUrl,
    })
    .from(leads)
    .where(and(isNotNull(leads.pdfUrl), lt(leads.pdfExpiresAt, now)));

  let deleted = 0;
  let errors = 0;
  for (const row of rows) {
    if (!row.pdfUrl) continue;
    const remotePath = extractRemotePathFromUrl(row.pdfUrl);
    try {
      if (remotePath) {
        await deleteFile(remotePath);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[cleanup-pdfs] delete failed for ${row.pdfUrl} (will still null columns):`,
        err instanceof Error ? err.message : err,
      );
      errors += 1;
    }
    try {
      await updateLeadStatus(row.id, { pdfUrl: null, pdfExpiresAt: null });
      deleted += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cleanup-pdfs] failed to null columns for ${row.id}:`, err);
      errors += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[cleanup-pdfs] done. removed=${deleted} errors=${errors} total=${rows.length}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[cleanup-pdfs] fatal:", err);
  process.exit(1);
});
