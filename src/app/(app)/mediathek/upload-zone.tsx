"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  CheckCircle2,
  XCircle,
  Plus,
  Video,
  Image as ImageIcon,
  Film,
  Shapes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WebcamRecorder } from "@/components/ui/webcam-recorder";
import {
  validateUpload,
  getMimeFromFilename,
} from "@/lib/upload";
import { cn } from "@/lib/utils";

/** Media kinds accepted by the /api/media POST endpoint. */
type MediaKind = "webcam" | "image" | "video" | "logo";

interface UploadingFile {
  id: string;
  file: File;
  kind: MediaKind;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

const KIND_OPTIONS: { value: MediaKind; label: string; icon: React.ReactNode }[] = [
  { value: "webcam", label: "Webcam", icon: <Video className="size-4" /> },
  { value: "video", label: "Video", icon: <Film className="size-4" /> },
  { value: "image", label: "Bild", icon: <ImageIcon className="size-4" /> },
  { value: "logo", label: "Logo", icon: <Shapes className="size-4" /> },
];

/**
 * Maps the API media kind to the upload-validation kind used by
 * `validateUpload`. Mirrors the server-side `toValidationKind` mapping.
 */
function toValidationKind(kind: MediaKind): "webcam" | "image" | "logo" {
  if (kind === "video" || kind === "webcam") return "webcam";
  if (kind === "logo") return "logo";
  return "image";
}

function inferKind(file: File): MediaKind {
  const mime = (file.type || getMimeFromFilename(file.name)).toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) {
    // Treat smallish images as logos by default, otherwise generic image.
    if (file.size <= 512 * 1024) return "logo";
    return "image";
  }
  return "image";
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Uploads a single file via XHR, exposing real upload progress so the
 * progress bar reflects the actual byte stream rather than just queued/done.
 */
function uploadWithProgress(
  file: File,
  kind: MediaKind,
  onProgress: (pct: number) => void,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.withCredentials = true;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        onProgress(Math.min(99, pct));
      }
    };
    xhr.onerror = () => reject(new Error("Netzwerk-Fehler"));
    xhr.onabort = () => reject(new Error("Upload abgebrochen"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = xhr.responseText;
      }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body,
      });
    };

    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    xhr.send(form);
  });
}

export interface UploadZoneProps {
  onClose?: () => void;
}

export function UploadZone({ onClose }: UploadZoneProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [files, setFiles] = React.useState<UploadingFile[]>([]);
  const [defaultKind, setDefaultKind] = React.useState<MediaKind | "auto">(
    "auto",
  );
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [recorderError, setRecorderError] = React.useState<string | null>(null);
  const [recorderUploading, setRecorderUploading] = React.useState(false);

  function pickKindForFile(file: File): MediaKind {
    if (defaultKind !== "auto") return defaultKind;
    return inferKind(file);
  }

  function addFiles(list: FileList | File[]) {
    const next: UploadingFile[] = [];
    for (const f of Array.from(list)) {
      const kind = pickKindForFile(f);
      const mime = f.type || getMimeFromFilename(f.name);
      const result = validateUpload({
        sizeBytes: f.size,
        mime,
        kind: toValidationKind(kind),
      });
      if (!result.ok) {
        next.push({
          id: randomId(),
          file: f,
          kind,
          progress: 0,
          status: "error",
          error: result.error,
        });
        continue;
      }
      next.push({
        id: randomId(),
        file: f,
        kind,
        progress: 0,
        status: "queued",
      });
    }
    setFiles((prev) => [...prev, ...next]);
    void uploadAll(next);
  }

  async function uploadAll(items: UploadingFile[]) {
    let anySucceeded = false;
    for (const item of items) {
      if (item.status === "error") continue;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: "uploading", progress: 0 } : f,
        ),
      );

      try {
        const res = await uploadWithProgress(item.file, item.kind, (pct) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, progress: pct } : f)),
          );
        });

        if (!res.ok) {
          const errorMsg =
            (res.body && typeof res.body === "object" && "error" in res.body
              ? String((res.body as { error: unknown }).error)
              : null) ?? `HTTP ${res.status}`;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? { ...f, status: "error", error: errorMsg, progress: 0 }
                : f,
            ),
          );
          continue;
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, progress: 100, status: "done" } : f,
          ),
        );
        anySucceeded = true;
      } catch (err) {
        console.error("[upload-zone] upload failed:", err);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "error",
                  error: err instanceof Error ? err.message : "Fehler",
                }
              : f,
          ),
        );
      }
    }
    if (anySucceeded) router.refresh();
  }

  async function handleRecorderConfirm(file: File) {
    setRecorderError(null);
    setRecorderUploading(true);
    try {
      const validation = validateUpload({
        sizeBytes: file.size,
        mime: file.type || "video/webm",
        kind: "webcam",
      });
      if (!validation.ok) {
        setRecorderError(validation.error);
        return;
      }
      const res = await uploadWithProgress(file, "webcam", () => {
        /* recorder dialog shows generic spinner, no per-byte progress bar */
      });
      if (!res.ok) {
        const errorMsg =
          (res.body && typeof res.body === "object" && "error" in res.body
            ? String((res.body as { error: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        setRecorderError(errorMsg);
        return;
      }
      setRecordOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[upload-zone] recorder upload failed:", err);
      setRecorderError(
        err instanceof Error ? err.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setRecorderUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted">
            Datei-Typ:
          </span>
          <div className="inline-flex rounded-full border border-line bg-surface p-1 gap-1">
            <button
              type="button"
              onClick={() => setDefaultKind("auto")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-full transition-colors",
                defaultKind === "auto"
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              Auto
            </button>
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDefaultKind(opt.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors",
                  defaultKind === opt.value
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            setRecorderError(null);
            setRecordOpen(true);
          }}
          iconLeft={<Video className="size-4" />}
        >
          Aufnehmen statt hochladen
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "border-2 border-dashed rounded-squircle-md p-10 text-center transition-colors duration-200 ease-spring",
          dragOver
            ? "border-brand bg-brand-soft"
            : "border-line bg-surface-soft",
        )}
      >
        <Upload className="size-8 text-ink-muted mx-auto mb-3" />
        <p className="text-sm font-semibold text-ink mb-1">
          Datei hier ablegen
        </p>
        <p className="text-xs text-ink-muted mb-4">
          Videos bis 500 MB, Bilder bis 10 MB, Logos bis 2 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          Dateien auswaehlen
        </Button>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 bg-surface border border-line rounded-squircle-md p-3"
            >
              <span className="shrink-0">
                {f.status === "done" && (
                  <CheckCircle2 className="size-5 text-ok" />
                )}
                {f.status === "error" && (
                  <XCircle className="size-5 text-danger" />
                )}
                {(f.status === "queued" || f.status === "uploading") && (
                  <span className="inline-block size-5 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink truncate">
                    {f.file.name}
                  </p>
                  <span className="text-xs text-ink-muted shrink-0">
                    {f.kind}
                  </span>
                </div>
                {f.status === "error" ? (
                  <p className="text-xs text-danger mt-1">{f.error}</p>
                ) : (
                  <Progress
                    value={f.progress}
                    indeterminate={f.status === "uploading" && f.progress < 1}
                    className="mt-1"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {onClose && (
        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Schliessen
          </Button>
        </div>
      )}

      <Dialog
        open={recordOpen}
        onOpenChange={(o) => {
          if (recorderUploading) return;
          setRecordOpen(o);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Webcam-Aufnahme</DialogTitle>
            <DialogDescription>
              Nimm direkt eine Aufnahme in deinem Browser auf. Sie wird in
              deiner Mediathek gespeichert.
            </DialogDescription>
          </DialogHeader>
          {recorderError && (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {recorderError}
            </div>
          )}
          {recorderUploading && (
            <div className="rounded-squircle-md border border-line bg-surface-soft px-4 py-3 text-sm text-ink-muted flex items-center gap-2">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              Upload laeuft ...
            </div>
          )}
          {recordOpen && (
            <WebcamRecorder
              onConfirm={handleRecorderConfirm}
              onCancel={() => {
                if (!recorderUploading) setRecordOpen(false);
              }}
              maxDurationSec={120}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function UploadDialogTrigger() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button iconLeft={<Plus className="size-4" />}>
          Datei hochladen
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Datei hochladen</DialogTitle>
          <DialogDescription>
            Lade Webcam-Aufnahmen, Bilder, Videos oder Logos in deine
            Mediathek hoch.
          </DialogDescription>
        </DialogHeader>
        <UploadZone onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
