/**
 * TEST-Script: erzeugt die Briefe einer Runde mit Renderer 4.1 (PDF-Overlay,
 * QR-Stamp via pdf-lib) NEU — ohne irgendetwas Bestehendes anzufassen.
 *
 * - Liest die Leads der Runde (aktiv, mit Slug) aus der DB.
 * - Rendert pro Lead das Brief-PDF über renderViaDocsApi mit qrOverlay.
 * - Lädt die PDFs unter overlay-test/<runId>/<slug>.pdf nach Bunny
 *   (videocomet-pdf-Zone) — bestehende leads.pdf_url bleibt unberührt,
 *   kein Statuswechsel, kein Kunde sieht etwas.
 * - Schreibt am Ende eine index.html mit allen Links + Ergebnis-JSON.
 *
 * Aufruf (Production-Container, Worker oder App):
 *   npx tsx scripts/overlay-test-digispace.ts                 → alle Leads
 *   npx tsx scripts/overlay-test-digispace.ts slug1,slug2     → nur diese Slugs
 *   SKIP_SLUGS_FILE=/tmp/ok-slugs.txt npx tsx …               → Resume
 */

import "dotenv/config";
import { readFile as readFileFs } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads, runs, campaigns } from "../src/lib/db/schema";
import { generateQrPng } from "../src/lib/qr";
import { uploadFile } from "../src/lib/bunny/storage";
import { substitute } from "../src/lib/placeholders/substitute";
import { renderViaDocsApi } from "../src/worker/lib/docs-native-pipeline";

const RUN_ID = process.env.OVERLAY_RUN_ID ?? "508fe55e-f44d-46bc-8915-decf3d5204f1";
const DOMAIN_HOSTNAME = process.env.OVERLAY_HOSTNAME ?? "video.digispace.at";
const OUT_PREFIX = `overlay-test/${RUN_ID.slice(0, 8)}`;
const CONCURRENCY = 3;

/** Nachbau von pipeline.ts buildDocxVars (dort nicht exportiert). */
function pickField(data: Record<string, string>, candidates: string[]): string {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) lower.set(k.toLowerCase(), v);
  for (const key of candidates) {
    const v = lower.get(key.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function buildDocxVars(
  leadData: Record<string, string>,
  landingpageUrl: string,
  mapping: Record<string, { column?: string; fallback?: string }> | Record<string, string> | undefined,
  pageUrlShort: string,
): Record<string, string> {
  const base: Record<string, string> = {
    ...leadData,
    landingpageUrl,
    landingpage_url: landingpageUrl,
    firstName: pickField(leadData, ["firstName", "Vorname", "first_name", "vorname"]),
    lastName: pickField(leadData, ["lastName", "Nachname", "last_name", "nachname"]),
    pageUrl: pageUrlShort,
  };
  if (mapping) {
    const system = { pageUrl: pageUrlShort };
    for (const key of Object.keys(mapping)) {
      const mappedRaw = (mapping as Record<string, unknown>)[key];
      const mappedStr =
        typeof mappedRaw === "string"
          ? mappedRaw
          : typeof mappedRaw === "object" && mappedRaw !== null
            ? ((mappedRaw as { column?: string }).column ?? "")
            : "";
      if (mappedStr === "@system:pageUrl") {
        base[key] = pageUrlShort;
        continue;
      }
      const v = substitute(`{{${key}}}`, leadData, mapping, "double-brace", system);
      if (typeof v === "string") base[key] = v;
    }
  }
  return base;
}

interface Result {
  slug: string;
  leadId: string;
  ok: boolean;
  url?: string;
  error?: string;
  ms: number;
}

async function main(): Promise<void> {
  const slugFilter = process.argv[2]
    ? new Set(process.argv[2].split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const [run] = await db
    .select({ campaignId: runs.campaignId, columnMapping: runs.columnMapping })
    .from(runs)
    .where(eq(runs.id, RUN_ID))
    .limit(1);
  if (!run) throw new Error(`run ${RUN_ID} nicht gefunden`);

  const [campaign] = await db
    .select({ pdfGoogleDocsUrl: campaigns.pdfGoogleDocsUrl })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  if (!campaign?.pdfGoogleDocsUrl) throw new Error("campaign hat keine pdf_google_docs_url");

  const storedCm = (run.columnMapping ?? {}) as {
    mapping?: Record<string, string>;
    placeholderMapping?: Record<string, { column?: string; fallback?: string }>;
  };
  const mapping = storedCm.placeholderMapping ?? storedCm.mapping;

  let rows = await db
    .select({ id: leads.id, slug: leads.slug, data: leads.data })
    .from(leads)
    .where(and(eq(leads.runId, RUN_ID), isNull(leads.removedAt), isNotNull(leads.slug)))
    .orderBy(asc(leads.rowIndex));
  if (slugFilter) rows = rows.filter((r) => r.slug && slugFilter.has(r.slug));
  if (process.env.SKIP_SLUGS_FILE) {
    const done = new Set(
      (await readFileFs(process.env.SKIP_SLUGS_FILE, "utf8"))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const before = rows.length;
    rows = rows.filter((r) => !r.slug || !done.has(r.slug));
    console.log(`[overlay-test] resume: ${before - rows.length} bereits fertig, ${rows.length} offen`);
  }
  console.log(`[overlay-test] ${rows.length} leads, template=${campaign.pdfGoogleDocsUrl}`);

  const results: Result[] = [];
  let cursor = 0;

  async function workerLoop(): Promise<void> {
    for (;;) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const lead = rows[idx];
      const slug = lead.slug!;
      const t0 = Date.now();
      const workDir = await mkdtemp(join(tmpdir(), `ovl-${slug.slice(0, 12)}-`));
      try {
        const pageUrlShort = `${DOMAIN_HOSTNAME}/${slug}`;
        const pageUrl = `https://${pageUrlShort}`;
        const vars = buildDocxVars(
          (lead.data ?? {}) as Record<string, string>,
          pageUrl,
          mapping,
          pageUrlShort,
        );
        const qrPngPath = join(workDir, "qr.png");
        await writeFile(qrPngPath, await generateQrPng(pageUrl, 400));

        const rendered = await renderViaDocsApi({
          googleDocsUrl: campaign.pdfGoogleDocsUrl!,
          textVars: vars,
          copyNameHint: `ovl-${slug.slice(0, 16)}`,
          qrPngPath,
          thumbnailFilePath: null,
          qrOverlay: { anchorText: slug, anchorFallbacks: [DOMAIN_HOSTNAME] },
        });
        if (!rendered.qrOverlayApplied) {
          throw new Error("qrOverlayApplied=false — Platzhalter nicht positioned?");
        }
        const uploaded = await uploadFile({
          buffer: rendered.pdfBuffer,
          remotePath: `${OUT_PREFIX}/${slug}.pdf`,
          contentType: "application/pdf",
        });
        results.push({ slug, leadId: lead.id, ok: true, url: uploaded.url, ms: Date.now() - t0 });
        console.log(
          `[overlay-test] ${results.length}/${rows.length} ok ${slug} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
        );
      } catch (err) {
        results.push({
          slug,
          leadId: lead.id,
          ok: false,
          error: (err as Error).message?.slice(0, 300),
          ms: Date.now() - t0,
        });
        console.error(`[overlay-test] FAIL ${slug}: ${(err as Error).message}`);
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => workerLoop()));

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  results.sort((a, b) => a.slug.localeCompare(b.slug));

  const indexHtml = `<!doctype html><html lang="de"><meta charset="utf-8">
<title>Overlay-Test DigiSpace ${RUN_ID.slice(0, 8)}</title>
<body style="font-family:system-ui;max-width:720px;margin:2rem auto;">
<h1>Overlay-Test (Renderer 4.1) — ${ok.length}/${results.length} ok</h1>
${failed.length ? `<h2>Fehlgeschlagen</h2><ul>${failed.map((r) => `<li>${r.slug}: ${r.error}</li>`).join("")}</ul>` : ""}
<ul>${ok.map((r) => `<li><a href="${r.url}">${r.slug}</a></li>`).join("\n")}</ul>
</body></html>`;
  const idx = await uploadFile({
    buffer: Buffer.from(indexHtml, "utf8"),
    remotePath: `${OUT_PREFIX}/index-${Date.now().toString(36)}.html`,
    contentType: "text/html",
  });

  console.log(`\n[overlay-test] fertig: ${ok.length} ok, ${failed.length} failed`);
  console.log(`[overlay-test] index: ${idx.url}`);
  await writeFile(
    `/tmp/overlay-test-results-${RUN_ID.slice(0, 8)}.json`,
    JSON.stringify({ index: idx.url, results }, null, 2),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[overlay-test] fatal:", err);
  process.exit(1);
});
