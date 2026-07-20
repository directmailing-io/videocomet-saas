"use client";

/**
 * Upload-Zone für ZIPs einer Custom-LP-Vorlage.
 *
 * Verantwortlich für:
 *   1. Drag&Drop + Click-to-Select
 *   2. Client-Side-Validierung (MIME + 50 MB Limit) → früher Reject
 *   3. POST an `/api/custom-lp/[id]/versions` (multipart/form-data)
 *   4. Progress-Indicator (XHR statt fetch — fetch hat keinen onprogress)
 *   5. Auswertung der Server-Antwort (errors / warnings / success)
 *
 * Bei Erfolg ruft die Komponente `onUploaded(file, response)` auf — der
 * Parent (detail-page) springt dann in den Element-Picker.
 *
 * Optional kann `annotations` mit ge-postet werden — das brauchen wir, wenn
 * der Kunde nach dem Picker erneut "Speichern" drückt: dann reuploaden wir
 * NICHT, sondern senden nur die Annotations als zweite Multipart-Datei
 * `annotations.json` — aber wir reuploaden hier immer, da der Versions-
 * Endpoint atomar arbeitet.
 */

import * as React from "react";
import { UploadCloud, FileArchive, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — synchron zu CUSTOM_LP_LIMITS

export interface UploadAffectedRun {
  runId: string;
  runName: string;
  campaignId?: string;
  campaignName: string;
}

export interface UploadVersionResult {
  version: {
    id: string;
    version: number;
    uploadedAt: string;
    entryHtml: string;
    bytesTotal: number;
    annotations: Record<string, unknown> | null;
  };
  affectedRuns: UploadAffectedRun[];
  warnings?: string[];
}

interface UploadZoneProps {
  templateId: string;
  /** Wird beim Upload mitgeschickt (z.B. nach Element-Picker-Rerun). */
  annotations?: Record<string, unknown> | null;
  /** Erfolgs-Callback — Parent kann jetzt Picker öffnen / Modal zeigen. */
  onUploaded: (result: UploadVersionResult, file: File) => void;
  /** Optional — informiert Parent dass eine Datei ausgewählt wurde
   *  (z.B. für Preview-Generierung VOR dem Server-Upload). */
  onFileSelected?: (file: File) => void;
  /** Wenn `false`, ist das Drop-Target deaktiviert (z.B. während Picker-Schritt). */
  disabled?: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number; file: File }
  | { kind: "validation_error"; error: string; message: string; path?: string }
  | { kind: "network_error"; message: string }
  | { kind: "success"; result: UploadVersionResult };

export function UploadZone({
  templateId,
  annotations,
  onUploaded,
  onFileSelected,
  disabled,
}: UploadZoneProps) {
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = React.useCallback(
    (file: File) => {
      // ── Frühe Client-Validierung ────────────────────────────────────────
      if (file.size > MAX_BYTES) {
        setStatus({
          kind: "validation_error",
          error: "ZIP_TOO_LARGE",
          message: `Datei ist zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB). Max. 50 MB.`,
        });
        return;
      }
      const lowerName = file.name.toLowerCase();
      const isZipMime =
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed" ||
        file.type === "";
      if (!isZipMime || !lowerName.endsWith(".zip")) {
        setStatus({
          kind: "validation_error",
          error: "ZIP_BAD_FORMAT",
          message: "Bitte laden Sie eine ZIP-Datei hoch.",
        });
        return;
      }

      onFileSelected?.(file);

      // ── Upload ──────────────────────────────────────────────────────────
      setStatus({ kind: "uploading", percent: 0, file });

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/custom-lp/${templateId}/versions`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setStatus((s) =>
            s.kind === "uploading"
              ? { ...s, percent: Math.min(99, pct) }
              : s,
          );
        }
      };

      xhr.onerror = () => {
        setStatus({
          kind: "network_error",
          message: "Verbindung zum Server fehlgeschlagen.",
        });
      };

      xhr.onload = () => {
        let body: unknown;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && body && typeof body === "object") {
          const result = body as UploadVersionResult;
          setStatus({ kind: "success", result });
          onUploaded(result, file);
        } else {
          const b = (body ?? {}) as {
            error?: string;
            message?: string;
            path?: string;
          };
          setStatus({
            kind: "validation_error",
            error: b.error ?? `HTTP_${xhr.status}`,
            message:
              b.message ??
              "Validierung fehlgeschlagen. Bitte prüfen Sie die ZIP-Inhalte.",
            path: b.path,
          });
        }
      };

      const fd = new FormData();
      fd.append("file", file);
      if (annotations && Object.keys(annotations).length > 0) {
        fd.append("annotations", JSON.stringify(annotations));
      }
      xhr.send(fd);
    },
    [annotations, onFileSelected, onUploaded, templateId],
  );

  // ── DnD-Handlers ─────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onPick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={onPick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex flex-col items-center justify-center text-center px-6 py-14 rounded-squircle-md border-2 border-dashed transition-colors cursor-pointer",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          dragOver
            ? "border-brand bg-brand-soft/40"
            : "border-line bg-surface-soft hover:border-brand/50",
          disabled && "opacity-60 cursor-not-allowed pointer-events-none",
        )}
        aria-disabled={disabled}
      >
        <div className="flex size-14 items-center justify-center rounded-squircle-md bg-brand-soft text-brand-deep mb-4">
          <UploadCloud className="size-7" />
        </div>
        <p className="text-base font-semibold text-ink mb-1">
          ZIP hier ablegen oder klicken
        </p>
        <p className="text-xs text-ink-muted max-w-sm leading-relaxed">
          Bis zu 50 MB. Erlaubt: HTML, CSS, JS, JSON, SVG, Bilder, Fonts, MP4
          &amp; WebM. <code className="font-mono">index.html</code> muss
          enthalten sein.
        </p>
        <a
          href="/anleitung-eigene-webseite.html"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-3 text-xs font-medium text-brand hover:underline"
        >
          Anleitung: So bereiten Sie Ihre Webseite vor (Platzhalter, Video,
          Klick-Messung)
        </a>

        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // reset so the same file can be re-picked
            e.target.value = "";
          }}
        />
      </div>

      {/* ── Status-Panels ──────────────────────────────────────────────── */}
      {status.kind === "uploading" && (
        <UploadProgress percent={status.percent} fileName={status.file.name} />
      )}

      {status.kind === "validation_error" && (
        <div className="rounded-squircle-md bg-danger-soft p-4 flex items-start gap-3">
          <XCircle className="size-5 text-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-danger">
              Upload fehlgeschlagen
            </p>
            <p className="text-sm text-ink mt-0.5">{status.message}</p>
            {status.path && (
              <p className="text-xs font-mono text-ink-muted mt-1">
                Pfad: {status.path}
              </p>
            )}
            <p className="text-xs text-ink-muted mt-1">
              Fehlercode:{" "}
              <code className="font-mono">{status.error}</code>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => setStatus({ kind: "idle" })}
            >
              Erneut versuchen
            </Button>
          </div>
        </div>
      )}

      {status.kind === "network_error" && (
        <div className="rounded-squircle-md bg-danger-soft p-4 flex items-start gap-3">
          <XCircle className="size-5 text-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-danger">Verbindungsfehler</p>
            <p className="text-sm text-ink mt-0.5">{status.message}</p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => setStatus({ kind: "idle" })}
            >
              Erneut versuchen
            </Button>
          </div>
        </div>
      )}

      {status.kind === "success" && (
        <div className="rounded-squircle-md bg-ok-soft p-4 flex items-start gap-3">
          <FileArchive className="size-5 text-ok shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ok">
              Version {status.result.version.version} gespeichert
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              {(status.result.version.bytesTotal / 1024).toFixed(0)} KB
              {" · "}Einstieg:{" "}
              <code className="font-mono">{status.result.version.entryHtml}</code>
            </p>
            {status.result.warnings && status.result.warnings.length > 0 && (
              <div className="mt-3 rounded-squircle-sm bg-warn-soft p-3 flex items-start gap-2">
                <AlertTriangle className="size-4 text-warn shrink-0 mt-0.5" />
                <div className="text-xs text-ink">
                  <p className="font-semibold text-warn">Hinweise</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {status.result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────

function UploadProgress({
  percent,
  fileName,
}: {
  percent: number;
  fileName: string;
}) {
  return (
    <div className="rounded-squircle-md bg-surface-soft p-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="inline-flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
          <UploadCloud className="size-4 animate-pulse" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{fileName}</p>
          <p className="text-xs text-ink-muted">
            {percent < 99 ? "Wird hochgeladen…" : "Wird validiert…"}
          </p>
        </div>
        <p className="text-sm font-mono tabular-nums text-ink-muted">
          {percent}%
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
