"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, XCircle, Plus } from "lucide-react";
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
import {
  validateUpload,
  getMimeFromFilename,
  type UploadKind,
} from "@/lib/upload";
import { cn } from "@/lib/utils";

interface UploadingFile {
  id: string;
  file: File;
  kind: UploadKind;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

function inferKind(file: File): UploadKind {
  const mime = file.type || getMimeFromFilename(file.name);
  if (mime.startsWith("video/")) return "webcam";
  if (mime.startsWith("image/")) {
    if (file.size <= 2 * 1024 * 1024) return "logo";
    return "image";
  }
  return "image";
}

export interface UploadZoneProps {
  onClose?: () => void;
}

export function UploadZone({ onClose }: UploadZoneProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [files, setFiles] = React.useState<UploadingFile[]>([]);

  function addFiles(list: FileList | File[]) {
    const next: UploadingFile[] = [];
    for (const f of Array.from(list)) {
      const kind = inferKind(f);
      const mime = f.type || getMimeFromFilename(f.name);
      const result = validateUpload({
        sizeBytes: f.size,
        mime,
        kind,
      });
      if (!result.ok) {
        next.push({
          id: `${Date.now()}-${Math.random()}`,
          file: f,
          kind,
          progress: 0,
          status: "error",
          error: result.error,
        });
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random()}`,
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
    for (const item of items) {
      if (item.status === "error") continue;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: "uploading" } : f,
        ),
      );
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("type", item.kind);
        const res = await fetch("/api/media", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          console.log("TODO API endpoint /api/media POST", res.status);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "error",
                    error: `HTTP ${res.status}`,
                  }
                : f,
            ),
          );
          continue;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, progress: 100, status: "done" }
              : f,
          ),
        );
      } catch (err) {
        console.log("TODO API endpoint /api/media POST", err);
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
    router.refresh();
  }

  return (
    <div className="space-y-4">
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
          "border-2 border-dashed rounded-squircle-md p-10 text-center transition-colors",
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
                <p className="text-sm font-medium text-ink truncate">
                  {f.file.name}
                </p>
                {f.status === "error" ? (
                  <p className="text-xs text-danger">{f.error}</p>
                ) : (
                  <Progress
                    value={
                      f.status === "done"
                        ? 100
                        : f.status === "uploading"
                          ? 50
                          : 0
                    }
                    indeterminate={f.status === "uploading"}
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

