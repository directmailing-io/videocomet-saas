"use client";

import * as React from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MoveVertical,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PdfSegment, ScrollFrame, Segment } from "@/lib/segments/types";
import {
  buildAutoScrollFrames,
  type AutoScrollStyle,
} from "@/lib/segments/scroll-math";
import { ScrollRecorderModal } from "./scroll-recorder-modal";

interface SegmentEditorPdfProps {
  segment: PdfSegment;
  onChange: (segment: PdfSegment) => void;
  /** Bunny-CDN-URL des Webcam-Videos (für PiP-Sync im Scroll-Recorder). */
  webcamUrl?: string | null;
  /** Alle Segmente — für Index-Berechnung im Webcam-Monitor. */
  allSegments?: Segment[];
  /** Index dieses Segments innerhalb von `allSegments`. */
  currentSegmentIndex?: number | null;
}

/** Client-seitiges Upload-Limit (Server prüft zusätzlich). */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Upload-Response von POST /api/pdf-segment/upload. */
interface PdfUploadResponse {
  pdfUrl?: string;
  pageUrls?: string[];
  pageCount?: number;
  docWidth?: number;
  docHeight?: number;
  fileName?: string;
  error?: string;
}

/**
 * Frame-Listen strukturell vergleichen (Toleranz für Float-Rundung).
 * Wird für die Auto-Modus-Erkennung genutzt — siehe `detectAutoScrollStyle`.
 */
function framesEqual(a: ScrollFrame[], b: ScrollFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].t - b[i].t) > 0.5) return false;
    if (Math.abs(a[i].y - b[i].y) > 1e-6) return false;
  }
  return true;
}

/**
 * Auto-Modus-Erkennung: Auto-Frames sind exakt der Generator-Output für
 * ihre eigene Endzeit (letztes Frame-t). Wir regenerieren die Kandidaten
 * für beide Stile und vergleichen strukturell — manuelle Aufnahmen (50ms-
 * Sampling, krumme Werte) matchen praktisch nie. Vorteil gegenüber einem
 * persistierten Flag: kein neues Schema-Feld, robust über Re-Mounts und
 * den Editor-Re-Entry hinweg.
 */
function detectAutoScrollStyle(
  frames: ScrollFrame[] | undefined,
  pageCount: number,
): AutoScrollStyle | null {
  if (!frames || frames.length === 0) return null;
  const lastT = frames[frames.length - 1].t;
  if (lastT <= 0) return null;
  for (const style of ["linear", "paged"] as const) {
    if (framesEqual(frames, buildAutoScrollFrames(lastT, { style, pageCount }))) {
      return style;
    }
  }
  return null;
}

type ScrollMode = "static" | "auto" | "manual";

interface ScrollModeOption {
  value: ScrollMode;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const SCROLL_MODES: ScrollModeOption[] = [
  {
    value: "static",
    title: "Standbild (erste Seite)",
    description: "Zeigt nur die erste Seite des PDFs, ohne Scrollen.",
    Icon: ImageIcon,
  },
  {
    value: "auto",
    title: "Automatisch scrollen",
    description: "Das PDF wird über die Segmentdauer automatisch durchgescrollt.",
    Icon: MoveVertical,
  },
  {
    value: "manual",
    title: "Scroll selbst aufnehmen",
    description: "Du scrollst einmal selbst, das Video spielt es 1:1 nach.",
    Icon: Camera,
  },
];

function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 100) / 10);
  return `${s.toFixed(1)}s`;
}

export function SegmentEditorPdf({
  segment,
  onChange,
  webcamUrl,
  allSegments,
  currentSegmentIndex,
}: SegmentEditorPdfProps) {
  const [recorderOpen, setRecorderOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const hasPdf = segment.pdfUrl.length > 0 && segment.pageUrls.length > 0;
  const frames = segment.scrollFrames ?? [];
  const hasFrames = frames.length > 0;
  const lastT = hasFrames ? frames[frames.length - 1].t : 0;

  // Abgeleiteter UI-Modus aus captureMode + Frame-Struktur.
  const autoStyle = detectAutoScrollStyle(segment.scrollFrames, segment.pageCount);
  const mode: ScrollMode =
    segment.captureMode === "static-hero"
      ? "static"
      : autoStyle !== null
        ? "auto"
        : "manual";

  // ── Auto-Frames bei Dauer-Änderung nachziehen ─────────────────────────
  // Auto-Frames enden immer exakt bei der Segmentdauer. Weicht das letzte
  // Frame-t von durationMs ab (Dauer wurde nachträglich getrimmt), sind die
  // Frames veraltet → mit derselben Stil-Wahl neu generieren. Manuelle
  // Aufnahmen bleiben unberührt (autoStyle === null).
  React.useEffect(() => {
    if (autoStyle === null) return;
    if (Math.abs(lastT - segment.durationMs) <= 0.5) return;
    onChange({
      ...segment,
      scrollFrames: buildAutoScrollFrames(segment.durationMs, {
        style: autoStyle,
        pageCount: segment.pageCount,
      }),
    });
    // Bewusst nur auf Dauer/Style reagieren — onChange/segment sind bei
    // jedem Render neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.durationMs, autoStyle, lastT]);

  // ── Upload-Flow ──────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setUploadError(null);
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError("Bitte eine PDF-Datei auswählen.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setUploadError("Die Datei ist größer als 25 MB. Bitte verkleinern.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pdf-segment/upload", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as PdfUploadResponse;
      if (!res.ok || !data.pdfUrl || !data.pageUrls) {
        setUploadError(
          data.error || `Upload fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      const pageCount = data.pageCount ?? data.pageUrls.length;
      onChange({
        ...segment,
        pdfUrl: data.pdfUrl,
        fileName: data.fileName ?? file.name,
        pageUrls: data.pageUrls,
        pageCount,
        docWidth: data.docWidth ?? 0,
        docHeight: data.docHeight ?? 0,
        // Alte Scroll-Aufnahmen passen nicht mehr zum neuen Dokument.
        // Aktiven Auto-Modus mit dem neuen pageCount regenerieren.
        scrollFrames:
          autoStyle !== null
            ? buildAutoScrollFrames(segment.durationMs, {
                style: autoStyle,
                pageCount,
              })
            : undefined,
      });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Netzwerkfehler beim Upload.",
      );
    } finally {
      setUploading(false);
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Input zurücksetzen, damit dieselbe Datei erneut wählbar ist.
    e.target.value = "";
    if (file) void handleFile(file);
  }

  // ── Modus-Wechsel ────────────────────────────────────────────────────
  function selectMode(next: ScrollMode) {
    if (next === "static") {
      // Frames behalten — ein Zurückwechseln zu auto/manual verliert nichts.
      onChange({ ...segment, captureMode: "static-hero" });
      return;
    }
    if (next === "auto") {
      onChange({
        ...segment,
        captureMode: "scroll-recorded",
        scrollFrames: buildAutoScrollFrames(segment.durationMs, {
          style: autoStyle ?? "linear",
          pageCount: segment.pageCount,
        }),
      });
      return;
    }
    // manual: Auto-Frames verwerfen (keine echte Aufnahme) + Recorder öffnen.
    onChange({
      ...segment,
      captureMode: "scroll-recorded",
      scrollFrames: autoStyle !== null ? undefined : segment.scrollFrames,
    });
    if (hasPdf) setRecorderOpen(true);
  }

  function selectAutoStyle(style: AutoScrollStyle) {
    onChange({
      ...segment,
      captureMode: "scroll-recorded",
      scrollFrames: buildAutoScrollFrames(segment.durationMs, {
        style,
        pageCount: segment.pageCount,
      }),
    });
  }

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* ── Datei-Bereich ─────────────────────────────────────────────── */}
      {!hasPdf ? (
        <div className="rounded-squircle-md border-2 border-dashed border-line bg-surface-soft p-5 text-center">
          {uploading ? (
            <div className="flex flex-col items-center gap-2.5">
              <Loader2 className="size-6 animate-spin text-brand-deep" />
              <p className="text-xs text-ink-muted">
                PDF wird verarbeitet — das kann bis zu 30 Sekunden dauern …
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                <FileUp className="size-5" />
              </span>
              <p className="text-sm font-semibold text-ink">PDF hochladen</p>
              <p className="text-xs text-ink-muted">
                Das PDF wird im Video wie in einem Viewer durchgescrollt.
              </p>
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                iconLeft={<FileUp className="size-3.5" />}
              >
                PDF auswählen (max. 25 MB)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-squircle-md border border-line bg-surface p-3">
          <div className="flex items-center gap-3">
            {/* Mini-Vorschau: erste Seite */}
            <div className="h-16 w-12 shrink-0 overflow-hidden rounded-sm border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={segment.pageUrls[0]}
                alt="Erste PDF-Seite"
                className="h-full w-full object-cover object-top"
                draggable={false}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {segment.fileName || "PDF-Dokument"}
              </p>
              <p className="text-xs text-ink-muted">
                {segment.pageCount}{" "}
                {segment.pageCount === 1 ? "Seite" : "Seiten"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            iconLeft={
              uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileUp className="size-3.5" />
              )
            }
            className="mt-2.5 w-full"
          >
            {uploading ? "PDF wird verarbeitet …" : "Anderes PDF hochladen"}
          </Button>
        </div>
      )}

      {uploadError && (
        <div className="flex gap-2 rounded-squircle-sm bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* ── Scroll-Einstellungen ──────────────────────────────────────── */}
      {hasPdf && (
        <>
          <div>
            <Label>Ablauf im Video</Label>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {SCROLL_MODES.map((opt) => (
                <ScrollModeCard
                  key={opt.value}
                  option={opt}
                  selected={mode === opt.value}
                  onSelect={() => selectMode(opt.value)}
                />
              ))}
            </div>
          </div>

          {/* Auto-Scroll: Stil-Toggle */}
          {mode === "auto" && (
            <div>
              <Label>Scroll-Stil</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    { v: "linear", label: "Gleichmäßig" },
                    { v: "paged", label: "Seitenweise blättern" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => selectAutoStyle(opt.v)}
                    aria-pressed={autoStyle === opt.v}
                    className={cn(
                      "rounded-squircle-md border p-2.5 text-xs font-medium transition-all",
                      autoStyle === opt.v
                        ? "border-brand bg-brand-soft text-brand-deep"
                        : "border-line text-ink hover:border-brand/50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manuelle Aufnahme: Status + Recorder-Button */}
          {mode === "manual" && (
            <div className="rounded-squircle-md border border-line bg-surface p-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-squircle-sm",
                    hasFrames
                      ? "bg-brand-soft text-brand-deep"
                      : "bg-surface-soft text-ink-muted",
                  )}
                >
                  {hasFrames ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <Camera className="size-4" />
                  )}
                </span>
                <p className="min-w-0 flex-1 text-xs text-ink-muted">
                  {hasFrames
                    ? `${frames.length} Frames, ${formatMs(lastT)} aufgezeichnet.`
                    : "Noch keine Aufnahme."}
                </p>
              </div>
              <Button
                type="button"
                variant={hasFrames ? "subtle" : "brand"}
                size="sm"
                onClick={() => setRecorderOpen(true)}
                iconLeft={<Camera className="size-3.5" />}
                className="mt-2.5 w-full"
              >
                {hasFrames ? "Erneut aufzeichnen" : "Aufnahme aufzeichnen"}
              </Button>
            </div>
          )}
        </>
      )}

      {recorderOpen && (
        <ScrollRecorderModal
          open={recorderOpen}
          onClose={() => setRecorderOpen(false)}
          targetUrl={segment.pdfUrl}
          segmentDurationMs={segment.durationMs}
          initialFrames={segment.scrollFrames}
          onSave={(scrollFrames: ScrollFrame[]) =>
            onChange({
              ...segment,
              captureMode: "scroll-recorded",
              scrollFrames,
            })
          }
          webcamUrl={webcamUrl ?? null}
          allSegments={allSegments ?? null}
          currentSegmentIndex={currentSegmentIndex ?? null}
          pages={{
            pageUrls: segment.pageUrls,
            docWidth: segment.docWidth,
            docHeight: segment.docHeight,
          }}
        />
      )}
    </div>
  );
}

/** Auswahl-Karte im Stil der Website/GDocs-CaptureModeCards. */
function ScrollModeCard({
  option,
  selected,
  onSelect,
}: {
  option: ScrollModeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon, title, description } = option;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-center gap-3 rounded-squircle-md border bg-surface p-3 text-left transition",
        "hover:border-brand-200 hover:bg-brand-soft/40",
        selected
          ? "border-brand-200 bg-brand-soft/60 ring-2 ring-brand"
          : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-squircle-sm",
          selected ? "bg-brand text-white" : "bg-surface-soft text-ink",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold leading-tight text-ink">
          {title}
        </span>
        <span className="text-xs leading-snug text-ink-muted">
          {description}
        </span>
      </span>
    </button>
  );
}
