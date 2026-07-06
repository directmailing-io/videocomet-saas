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
  const remotePath = `runs/${input.runId}/leads/${input.leadId}.pdf`;
  const buffer = await readFile(input.pdfPath);
  const upload = await uploadFile({
    buffer,
    remotePath,
    contentType: "application/pdf",
  });

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  // Cache-Buster: Bunny CDN cached statische Assets 30 Tage. Beim Regenerate
  // ueberschreibt der Worker die Storage-Datei, aber der CDN-Edge liefert
  // weiter die alte Version. Query-String macht den URL fuer den CDN eindeutig.
  const cacheBustedUrl = `${upload.url}?v=${Date.now()}`;

  await updateLeadStatus(input.leadId, {
    pdfUrl: cacheBustedUrl,
    pdfExpiresAt: expiresAt,
  });

  return {
    pdfUrl: cacheBustedUrl,
    pdfRemotePath: upload.remotePath,
    pdfExpiresAt: expiresAt,
  };
}
