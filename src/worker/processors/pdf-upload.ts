/**
 * Stage 9: PDF upload to Bunny Edge Storage.
 *
 * Stores at `runs/{runId}/leads/{leadId}.pdf` with a 7-day TTL. The
 * `pdfExpiresAt` column drives the 7d-cleanup cron job (see
 * `scripts/cleanup-pdfs.ts`).
 */

import { readFile } from "node:fs/promises";
import { uploadFile } from "@/lib/bunny/storage";
import { updateLeadStatus } from "@/lib/db/queries/leads";

export interface PdfUploadInput {
  leadId: string;
  runId: string;
  pdfPath: string;
  ttlDays?: number;
}

export interface PdfUploadOutput {
  pdfUrl: string;
  pdfRemotePath: string;
  pdfExpiresAt: Date;
}

export async function runPdfUpload(
  input: PdfUploadInput,
): Promise<PdfUploadOutput> {
  const ttlDays = input.ttlDays ?? Number(process.env.PDF_TTL_DAYS ?? 7);
  // Path-Version-Suffix: Bunny CDN ignoriert Query-Strings beim Cache-Key
  // (getestet: HIT trotz frischem ?v=). Deshalb baut jeder Upload einen
  // NEUEN Storage-Path — CDN kennt ihn nicht → cache miss → fresh Fetch.
  // Die alte Datei bleibt im Storage bis der Sweeper sie mit dem
  // Lead-Delete aufraeumt (bunny_asset_refs-basiert).
  const version = Date.now().toString(36);
  const remotePath = `runs/${input.runId}/leads/${input.leadId}-v${version}.pdf`;
  const buffer = await readFile(input.pdfPath);
  const upload = await uploadFile({
    buffer,
    remotePath,
    contentType: "application/pdf",
  });

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await updateLeadStatus(input.leadId, {
    pdfUrl: upload.url,
    pdfExpiresAt: expiresAt,
  });

  return {
    pdfUrl: upload.url,
    pdfRemotePath: upload.remotePath,
    pdfExpiresAt: expiresAt,
  };
}
