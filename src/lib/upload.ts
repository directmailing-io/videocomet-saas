/**
 * Upload-validation helpers.
 *
 * Defines size caps per upload kind and provides:
 *  - validateUpload(): checks size + mime against the kind's allowlist
 *  - getMimeFromFilename(): maps common extensions to mime types
 */

export const MAX_WEBCAM_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_DOCX_BYTES = 20 * 1024 * 1024;

export type UploadKind = "webcam" | "image" | "logo" | "docx";

export interface ValidateUploadInput {
  sizeBytes: number;
  mime: string;
  kind: UploadKind;
}

export type ValidateUploadResult =
  | { ok: true }
  | { ok: false; error: string };

const ALLOWED_MIMES: Record<UploadKind, ReadonlyArray<string>> = {
  webcam: ["video/mp4", "video/webm", "video/quicktime"],
  image: ["image/jpeg", "image/png", "image/svg+xml"],
  logo: ["image/png", "image/svg+xml", "image/jpeg"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

const MAX_BYTES: Record<UploadKind, number> = {
  webcam: MAX_WEBCAM_VIDEO_BYTES,
  image: MAX_IMAGE_BYTES,
  logo: MAX_LOGO_BYTES,
  docx: MAX_DOCX_BYTES,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function validateUpload(
  opts: ValidateUploadInput,
): ValidateUploadResult {
  const { sizeBytes, mime, kind } = opts;

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "Datei ist leer oder ungültig." };
  }

  const max = MAX_BYTES[kind];
  if (sizeBytes > max) {
    return {
      ok: false,
      error: `Datei zu groß (${formatBytes(sizeBytes)}). Maximum für ${kind}: ${formatBytes(
        max,
      )}.`,
    };
  }

  const allowed = ALLOWED_MIMES[kind];
  // Strip codec parameters: browsers send `video/webm;codecs=vp8,opus` from
  // MediaRecorder, but the allow-list only contains the base type.
  const normalizedMime = mime.toLowerCase().trim().split(";")[0].trim();
  if (!allowed.includes(normalizedMime)) {
    return {
      ok: false,
      error: `MIME-Typ ${mime} ist für ${kind} nicht erlaubt. Erlaubt: ${allowed.join(", ")}.`,
    };
  }

  return { ok: true };
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function getMimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === filename.length - 1) {
    return "application/octet-stream";
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
