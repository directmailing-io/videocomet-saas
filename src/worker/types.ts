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
