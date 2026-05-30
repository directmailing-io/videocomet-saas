/**
 * Shared types for the worker pipeline.
 *
 * Pipeline jobs are keyed on a single Lead (one DB row). Each stage in the
 * pipeline is composable and operates on a shared `LeadJobData` payload.
 */

export interface LeadJobData {
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
  /**
   * When `true`, the pipeline skips all video-related stages (render, upload,
   * thumbnail, landingpage) and only re-generates the PDF brief. The existing
   * `videoUrl`, `thumbnailUrl`, `slug`, etc. on the lead row are kept intact.
   * Used by selective regeneration ("Nur Brief neu generieren").
   */
  skipVideo?: boolean;
  /**
   * When `true`, the pipeline skips the DOCX → PDF stages (docx-modify,
   * docx-to-pdf, pdf-compress, pdf-upload). Existing `lead.pdfUrl` is kept.
   * Used by selective regeneration ("Nur Video neu generieren").
   */
  skipPdf?: boolean;
}

export interface RenderJobResult {
  videoFilePath: string;
  thumbFilePath: string;
  durationSec: number;
}

export interface VideoUploadResult {
  bunnyVideoId: string;
  videoUrl: string;
  thumbnailUrl: string;
}

export interface PdfUploadResult {
  pdfUrl: string;
  pdfRemotePath: string;
  pdfExpiresAt: Date;
}

export interface PipelineContext {
  job: LeadJobData;
  workDir: string;
  // Filled in as stages complete:
  videoFilePath?: string;
  thumbFilePath?: string;
  durationSec?: number;
  bunnyVideoId?: string;
  videoUrl?: string;
  qrPngPath?: string;
  slug?: string;
  pageUrl?: string;
  docxPath?: string;
  pdfPath?: string;
  compressedPdfPath?: string;
  pdfUrl?: string;
}

/**
 * Identifiers for each pipeline stage. Used for logging + status updates.
 */
export const PIPELINE_STAGES = [
  "video-render",
  "video-upload",
  "thumbnail-extract",
  "qr-generate",
  "landingpage-create",
  "docx-modify",
  "docx-to-pdf",
  "pdf-compress",
  "pdf-upload",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
