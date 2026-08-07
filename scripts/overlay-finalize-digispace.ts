/**
 * Finalisierung des Overlay-Tests: prüft, dass für JEDEN aktiven Lead der
 * Runde ein korrigiertes PDF unter overlay-test/<runPrefix>/ liegt, baut
 * daraus ein ZIP (für den Druck bei DigiSpace) + eine index.html und lädt
 * beides nach Bunny. Bestehende Produktions-PDFs bleiben unberührt.
 *
 * Aufruf: npx tsx scripts/overlay-finalize-digispace.ts
 */

import "dotenv/config";
import AdmZip from "adm-zip";
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads } from "../src/lib/db/schema";
import { uploadFile } from "../src/lib/bunny/storage";

const RUN_ID = "508fe55e-f44d-46bc-8915-decf3d5204f1";
const OUT_PREFIX = `overlay-test/${RUN_ID.slice(0, 8)}`;
const CDN_BASE = `https://videocomet-pdf.b-cdn.net/${OUT_PREFIX}`;
const CONCURRENCY = 8;

async function main(): Promise<void> {
  const rows = await db
    .select({ slug: leads.slug, rowIndex: leads.rowIndex })
    .from(leads)
    .where(and(eq(leads.runId, RUN_ID), isNull(leads.removedAt), isNotNull(leads.slug)))
    .orderBy(asc(leads.rowIndex));
  console.log(`[finalize] ${rows.length} leads erwartet`);

  const zip = new AdmZip();
  const ok: string[] = [];
  const missing: string[] = [];
  let cursor = 0;

  async function workerLoop(): Promise<void> {
    for (;;) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const slug = rows[idx].slug!;
      try {
        const res = await fetch(`${CDN_BASE}/${slug}.pdf`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("kein PDF");
        zip.addFile(`briefe/${slug}.pdf`, buf);
        ok.push(slug);
        if (ok.length % 50 === 0) console.log(`[finalize] ${ok.length}/${rows.length} geprüft`);
      } catch (err) {
        missing.push(slug);
        console.error(`[finalize] FEHLT ${slug}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => workerLoop()));

  if (missing.length > 0) {
    console.error(`\n[finalize] ABBRUCH: ${missing.length} PDFs fehlen:\n${missing.join("\n")}`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const zipBuf = zip.toBuffer();
  console.log(`[finalize] ZIP: ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB`);
  const zipUp = await uploadFile({
    buffer: zipBuf,
    remotePath: `${OUT_PREFIX}/VIDEOCOMET-briefe-jobs-at-korrigiert-${stamp}.zip`,
    contentType: "application/zip",
  });

  const bySlug = [...ok].sort((a, b) => a.localeCompare(b));
  const indexHtml = `<!doctype html><html lang="de"><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Korrigierte Briefe — jobs.at (${stamp})</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;line-height:1.5;">
<h1>Korrigierte Briefe — Runde jobs.at</h1>
<p>${ok.length} Briefe, QR-Code-Position korrigiert (Stand ${stamp}).</p>
<p><a href="${zipUp.url}" style="font-weight:bold;">&#8595; Alle Briefe als ZIP herunterladen (${(zipBuf.length / 1024 / 1024).toFixed(0)} MB)</a></p>
<details><summary>Einzelne PDFs (${ok.length})</summary><ul>
${bySlug.map((s) => `<li><a href="${CDN_BASE}/${s}.pdf">${s}</a></li>`).join("\n")}
</ul></details>
</body></html>`;
  const idxUp = await uploadFile({
    buffer: Buffer.from(indexHtml, "utf8"),
    remotePath: `${OUT_PREFIX}/briefe-${stamp}.html`,
    contentType: "text/html",
  });

  console.log(`\n[finalize] fertig: ${ok.length} Briefe`);
  console.log(`[finalize] Übersicht: ${idxUp.url}`);
  console.log(`[finalize] ZIP:       ${zipUp.url}`);
}

main().catch((err) => {
  console.error("[finalize] fatal:", err);
  process.exit(1);
});
