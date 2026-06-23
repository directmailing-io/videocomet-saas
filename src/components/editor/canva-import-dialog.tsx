"use client";

import * as React from "react";
import {
  Wand2,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CanvaSegment } from "@/lib/segments/types";
import { createCanvaSegment } from "@/lib/segments/defaults";

/**
 * Multi-Step-Dialog zum Importieren von Canva-Folien (PPTX-Pipeline).
 *
 * Schritte:
 *   1. Anleitung + PPTX-Datei hochladen (Drag-and-Drop ODER Click).
 *   2. Folien-Auswahl (Grid mit Thumbnails + Platzhalter-Pillen +
 *      Per-Slide-Dauer-Picker).
 *
 * Bei Erfolg erzeugt der Dialog für jede ausgewählte Folie ein
 * `canva`-Segment via Factory und reicht es per `onAddSegments`
 * an den Wizard zurück.
 */

export interface CanvaImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Maximale Dauer für die Summe aller neu hinzugefügten Folien (ms).
   * Wird vom Wizard auf Basis des verbleibenden Webcam-Budgets gesetzt.
   * `null` = unbekannt / keine Grenze in der UI.
   */
  remainingBudgetMs: number | null;
  /** Mindest-Dauer pro Folie (ms) — Wizard-Konstante. */
  minPerSegmentMs: number;
  /** Callback, wenn der User auf „N Folien hinzufügen" klickt. */
  onAddSegments: (segments: CanvaSegment[]) => void;
  /**
   * Im Replace-Modus erlaubt der Dialog nur Single-Select und beschriftet
   * den Footer-Button mit „Folie ersetzen" statt „N Folien hinzufügen".
   */
  replaceMode?: boolean;
}

interface ImportedSlide {
  slideIndex: number;
  thumbnailUrl: string | null;
  detectedPlaceholders: string[];
}

interface UploadResponse {
  mediaId: string;
  publicUrl: string;
  fileName: string;
}

interface ProcessResponse {
  slideCount: number;
  fileName: string | null;
  slides: Array<{
    slideIndex?: number;
    index?: number;
    thumbnailUrl: string | null;
    detectedPlaceholders: string[];
  }>;
}

const DURATION_OPTIONS_S = [2, 3, 4, 5, 6, 8, 10, 15] as const;
const DEFAULT_DURATION_S = 4;

const MAX_PPTX_BYTES = 50 * 1024 * 1024; // 50 MB
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Validiert: pptx-Endung ODER pptx-MIME. Browser sind hier
 * inkonsistent (Safari schickt häufig "application/octet-stream").
 */
function isPlausiblePptx(file: File): boolean {
  if (/\.pptx$/i.test(file.name)) return true;
  const m = (file.type || "").toLowerCase();
  return m.startsWith(
    "application/vnd.openxmlformats-officedocument.presentationml",
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Inline-SVG: schlichtes Canva-„C"-Mark. Wir vermeiden externes Asset, damit
 * der Dialog ohne Build-Step-Konfiguration immer funktioniert.
 */
function CanvaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="currentColor"
    >
      <path d="M12.36 2C6.78 2 2.32 6.46 2.32 12.04S6.78 22.08 12.36 22.08c4.96 0 9.18-3.6 9.94-8.4l-3.06-.48c-.42 2.94-2.94 5.16-5.94 5.16-3.36 0-6.06-2.7-6.06-6.06s2.7-6.06 6.06-6.06c2.04 0 3.84.96 4.92 2.52l2.7-1.8C19.32 4.7 16.08 2.66 12.36 2.66z" />
    </svg>
  );
}

export function CanvaImportDialog({
  open,
  onOpenChange,
  remainingBudgetMs,
  minPerSegmentMs,
  onAddSegments,
  replaceMode = false,
}: CanvaImportDialogProps) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [uploading, setUploading] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [uploaded, setUploaded] = React.useState<UploadResponse | null>(null);
  const [slides, setSlides] = React.useState<ImportedSlide[]>([]);
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(
    new Set(),
  );
  // Per-Folie-Dauer (Sekunden), key = slideIndex. Falls leer → DEFAULT.
  const [perSlideDurationS, setPerSlideDurationS] = React.useState<
    Record<number, number>
  >({});

  // Reset beim Schließen, damit ein erneutes Öffnen frisch startet.
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep(1);
        setUploading(false);
        setProcessing(false);
        setUploadProgress(0);
        setErrorMsg(null);
        setUploaded(null);
        setSlides([]);
        setSelectedIndices(new Set());
        setPerSlideDurationS({});
      }, 180);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  async function handleFileSelected(file: File) {
    setErrorMsg(null);
    if (!isPlausiblePptx(file)) {
      setErrorMsg(
        "Nur PowerPoint-Dateien (.pptx) sind erlaubt. Exportiere dein Canva-Design über Teilen → Mehr → PowerPoint (.pptx).",
      );
      return;
    }
    if (file.size > MAX_PPTX_BYTES) {
      setErrorMsg(
        `Datei zu groß (${formatBytes(file.size)}). Maximum: 50 MB.`,
      );
      return;
    }

    // ── 1) Upload nach Bunny via /api/canva/upload ───────────────────────
    setUploading(true);
    setUploadProgress(0);
    let upload: UploadResponse | null = null;
    try {
      upload = await new Promise<UploadResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/canva/upload");
        xhr.withCredentials = true;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploadProgress(Math.min(99, pct));
          }
        };
        xhr.onerror = () => reject(new Error("Netzwerk-Fehler beim Upload."));
        xhr.onabort = () => reject(new Error("Upload abgebrochen."));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const body = JSON.parse(xhr.responseText) as UploadResponse;
              resolve(body);
            } catch {
              reject(new Error("Antwort konnte nicht gelesen werden."));
            }
          } else {
            let msg = `Upload fehlgeschlagen (HTTP ${xhr.status}).`;
            try {
              const parsed = JSON.parse(xhr.responseText) as { error?: string };
              if (parsed?.error) msg = parsed.error;
            } catch {
              /* not json */
            }
            reject(new Error(msg));
          }
        };
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
      setUploadProgress(100);
      setUploaded(upload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
      setUploading(false);
      return;
    }
    setUploading(false);

    // ── 2) PPTX processen → Folien-Liste ─────────────────────────────────
    setProcessing(true);
    try {
      const res = await fetch("/api/canva/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pptxMediaId: upload.mediaId }),
      });
      if (!res.ok) {
        let msg = "Folien-Verarbeitung fehlgeschlagen.";
        try {
          const parsed = (await res.json()) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch {
          /* not json */
        }
        setErrorMsg(msg);
        return;
      }
      const data = (await res.json()) as ProcessResponse;
      // Backend kann `index` oder `slideIndex` liefern — beides tolerieren.
      const normalized: ImportedSlide[] = (data.slides || []).map((s, i) => ({
        slideIndex: typeof s.slideIndex === "number"
          ? s.slideIndex
          : typeof s.index === "number"
            ? s.index
            : i,
        thumbnailUrl: s.thumbnailUrl ?? null,
        detectedPlaceholders: Array.isArray(s.detectedPlaceholders)
          ? s.detectedPlaceholders
          : [],
      }));
      if (normalized.length === 0) {
        setErrorMsg(
          "Im Deck wurden keine Folien gefunden. Stelle sicher, dass dein Canva-Design Folien enthält.",
        );
        return;
      }
      setSlides(normalized);

      // Vor-Selektion: alle Folien mit ≥1 Platzhalter; Fallback alle.
      const preSelected = new Set<number>();
      for (const s of normalized) {
        if (s.detectedPlaceholders.length > 0) preSelected.add(s.slideIndex);
      }
      if (preSelected.size === 0) {
        for (const s of normalized) preSelected.add(s.slideIndex);
      }
      // Im Replace-Modus nur eine Folie vor-selektieren.
      if (replaceMode && preSelected.size > 1) {
        const first = Math.min(...Array.from(preSelected));
        setSelectedIndices(new Set([first]));
      } else {
        setSelectedIndices(preSelected);
      }
      setStep(2);
    } catch {
      setErrorMsg(
        "Folien konnten nicht geladen werden. Bitte erneut versuchen.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function toggleSlide(idx: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (replaceMode) {
        // Single-Select: immer nur die zuletzt geklickte.
        next.clear();
        if (!prev.has(idx)) next.add(idx);
        return next;
      }
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    if (replaceMode) return;
    if (selectedIndices.size === slides.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(slides.map((s) => s.slideIndex)));
    }
  }

  function setSlideDuration(idx: number, s: number) {
    setPerSlideDurationS((prev) => ({ ...prev, [idx]: s }));
  }

  function durationForSlide(idx: number): number {
    return perSlideDurationS[idx] ?? DEFAULT_DURATION_S;
  }

  function handleAdd() {
    if (!uploaded) return;
    if (selectedIndices.size === 0) return;
    const orderedSlides = [...slides].sort(
      (a, b) => a.slideIndex - b.slideIndex,
    );
    const chosen = orderedSlides.filter((s) =>
      selectedIndices.has(s.slideIndex),
    );
    const created: CanvaSegment[] = chosen.map((s) => {
      const durationMs = Math.max(
        minPerSegmentMs,
        durationForSlide(s.slideIndex) * 1000,
      );
      const seg = createCanvaSegment({ durationMs });
      return {
        ...seg,
        pptxMediaId: uploaded.mediaId,
        pptxPublicUrl: uploaded.publicUrl,
        fileName: uploaded.fileName,
        slideIndex: s.slideIndex,
        thumbnailUrl: s.thumbnailUrl,
        detectedPlaceholders: s.detectedPlaceholders,
        lastFetchedAt: new Date().toISOString(),
      };
    });
    onAddSegments(created);
    onOpenChange(false);
  }

  const allSelected =
    slides.length > 0 && selectedIndices.size === slides.length;
  const someSelected = selectedIndices.size > 0;

  // Gesamt-Dauer der Selektion + Budget-Check.
  const requestedTotalMs = Array.from(selectedIndices).reduce(
    (acc, idx) => acc + durationForSlide(idx) * 1000,
    0,
  );
  const budgetExceeded =
    remainingBudgetMs != null && requestedTotalMs > remainingBudgetMs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
              <Wand2 className="size-5" />
            </span>
            <div>
              <DialogTitle>
                {replaceMode
                  ? "Andere Canva-Folie einbinden"
                  : "Canva-Design importieren"}
              </DialogTitle>
              <DialogDescription>
                {step === 1
                  ? "Exportiere dein Design als PowerPoint (.pptx) und lade die Datei hier hoch — wir erkennen Platzhalter automatisch."
                  : `${slides.length} Folien gefunden${uploaded?.fileName ? ` in ${uploaded.fileName}` : ""} — wähle aus, welche du nutzen möchtest.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === 1 ? (
          <Step1Upload
            uploading={uploading}
            processing={processing}
            uploadProgress={uploadProgress}
            errorMsg={errorMsg}
            onCancel={() => onOpenChange(false)}
            onFile={handleFileSelected}
          />
        ) : (
          <Step2Selection
            slides={slides}
            fileName={uploaded?.fileName ?? null}
            selectedIndices={selectedIndices}
            allSelected={allSelected}
            someSelected={someSelected}
            replaceMode={replaceMode}
            perSlideDurationS={perSlideDurationS}
            onSlideDurationChange={setSlideDuration}
            budgetExceeded={budgetExceeded}
            remainingBudgetMs={remainingBudgetMs}
            requestedTotalMs={requestedTotalMs}
            onToggleSlide={toggleSlide}
            onToggleAll={toggleAll}
            onBack={() => {
              setStep(1);
              setErrorMsg(null);
            }}
            onCancel={() => onOpenChange(false)}
            onAdd={handleAdd}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Step 1: Anleitung + File-Upload ─────────────────────────────────────── */

function Step1Upload({
  uploading,
  processing,
  uploadProgress,
  errorMsg,
  onCancel,
  onFile,
}: {
  uploading: boolean;
  processing: boolean;
  uploadProgress: number;
  errorMsg: string | null;
  onCancel: () => void;
  onFile: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const busy = uploading || processing;

  return (
    <div className="space-y-5">
      {/* Info-Box mit Canva-Branding */}
      <div className="rounded-squircle-md border border-line bg-surface-soft p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#00C4CC] text-white">
            <CanvaMark className="size-4" />
          </span>
          <span className="text-sm font-semibold text-ink">
            So holst du dein Design aus Canva
          </span>
        </div>
        <ol className="space-y-2">
          {[
            "Öffne dein Design in Canva.",
            <>
              Klicke oben rechts auf{" "}
              <strong className="font-semibold text-ink">Teilen</strong> →{" "}
              <strong className="font-semibold text-ink">Mehr</strong> →{" "}
              <strong className="font-semibold text-ink">
                PowerPoint (.pptx)
              </strong>
              .
            </>,
            "Lade die heruntergeladene Datei hier unten hoch.",
          ].map((text, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                {idx + 1}
              </span>
              <span className="text-sm leading-relaxed text-ink-soft">
                {text}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Drop-Zone */}
      <div className="space-y-2">
        <Label>PPTX-Datei</Label>
        <div
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (busy) return;
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={cn(
            "relative flex flex-col items-center justify-center gap-3 rounded-squircle-md border-2 border-dashed px-6 py-10 text-center transition-colors duration-200 ease-spring",
            busy
              ? "border-line bg-surface-soft cursor-not-allowed"
              : dragOver
                ? "border-brand bg-brand-soft"
                : "border-line bg-surface-soft hover:border-brand/50",
          )}
        >
          {busy ? (
            <>
              <span className="inline-block size-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-sm font-semibold text-ink">
                {uploading
                  ? "PPTX wird hochgeladen …"
                  : "Folien werden verarbeitet …"}
              </p>
              {uploading && (
                <div className="w-full max-w-xs">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full bg-brand transition-all duration-300 ease-spring"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">
                    {uploadProgress}%
                  </p>
                </div>
              )}
              {processing && (
                <p className="text-xs text-ink-muted">
                  LibreOffice rendert die Thumbnails — kann 10–30 s dauern.
                </p>
              )}
            </>
          ) : (
            <>
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                <Upload className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  Datei hier ablegen oder klicken
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  PowerPoint-Dateien (.pptx) bis 50 MB
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="subtle"
                size="sm"
                onClick={() => inputRef.current?.click()}
                iconLeft={<FileSpreadsheet className="size-3.5" />}
              >
                Datei auswählen
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Server-Error */}
      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <XCircle className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">{errorMsg}</span>
        </div>
      )}

      {/* Info-Banner */}
      <div className="flex items-start gap-2.5 rounded-squircle-sm border border-brand-200 bg-brand-soft px-4 py-3 text-sm text-brand-deep">
        <Info className="size-4 shrink-0 mt-0.5" />
        <span className="leading-snug">
          Wir laden dein Deck einmalig hoch, ersetzen Platzhalter wie{" "}
          <code className="font-mono text-xs bg-brand-200/30 px-1 rounded">
            {`{{firstName}}`}
          </code>{" "}
          pro Lead und rendern serverseitig — niemand außer dir sieht die
          Original-Datei.
        </span>
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

/* ── Step 2: Folien-Auswahl ──────────────────────────────────────────────── */

function Step2Selection({
  slides,
  fileName,
  selectedIndices,
  allSelected,
  someSelected,
  replaceMode,
  perSlideDurationS,
  onSlideDurationChange,
  budgetExceeded,
  remainingBudgetMs,
  requestedTotalMs,
  onToggleSlide,
  onToggleAll,
  onBack,
  onCancel,
  onAdd,
}: {
  slides: ImportedSlide[];
  fileName: string | null;
  selectedIndices: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  replaceMode: boolean;
  perSlideDurationS: Record<number, number>;
  onSlideDurationChange: (idx: number, s: number) => void;
  budgetExceeded: boolean;
  remainingBudgetMs: number | null;
  requestedTotalMs: number;
  onToggleSlide: (idx: number) => void;
  onToggleAll: () => void;
  onBack: () => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const count = selectedIndices.size;

  return (
    <div className="space-y-4">
      {/* Erfolgs-Banner */}
      <div className="flex items-start gap-2.5 rounded-squircle-sm border border-brand-200 bg-brand-soft px-4 py-3 text-sm text-brand-deep">
        <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
        <span className="leading-snug">
          Platzhalter wie{" "}
          <code className="font-mono text-xs bg-brand-200/30 px-1 rounded">
            {`{{firstName}}`}
          </code>{" "}
          werden pro Lead automatisch ersetzt.
        </span>
      </div>

      {/* Header-Zeile mit Datei + Bulk-Aktion */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-sm border border-line bg-surface-soft px-4 py-3">
        <div className="min-w-0 text-xs text-ink-muted leading-snug">
          {fileName ? (
            <>
              <span aria-hidden>📁</span>{" "}
              <span className="font-semibold text-ink">{fileName}</span>{" "}
              · <span className="text-ink-muted">{slides.length} Folien</span>
            </>
          ) : (
            <span>{slides.length} Folien gefunden</span>
          )}
        </div>
        {!replaceMode && (
          <button
            type="button"
            onClick={onToggleAll}
            className="text-xs font-semibold text-brand-deep hover:text-brand transition-colors"
          >
            {allSelected ? "Auswahl aufheben" : "Alle auswählen"}
          </button>
        )}
      </div>

      {/* Budget-Hinweis */}
      {budgetExceeded && remainingBudgetMs != null && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-warn" />
          <span className="leading-snug">
            Auswahl summiert auf{" "}
            <strong className="font-semibold">
              {(requestedTotalMs / 1000).toFixed(1)}s
            </strong>{" "}
            und überschreitet das freie Webcam-Budget von{" "}
            <strong className="font-semibold">
              {(remainingBudgetMs / 1000).toFixed(1)}s
            </strong>
            . Wir kürzen die letzten Folien automatisch, damit alles passt.
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-[440px] overflow-y-auto pr-1">
        {slides.map((slide) => {
          const selected = selectedIndices.has(slide.slideIndex);
          const durS =
            perSlideDurationS[slide.slideIndex] ?? DEFAULT_DURATION_S;
          return (
            <SlideCard
              key={slide.slideIndex}
              slide={slide}
              selected={selected}
              durationS={durS}
              onToggleSelect={() => onToggleSlide(slide.slideIndex)}
              onDurationChange={(s) =>
                onSlideDurationChange(slide.slideIndex, s)
              }
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            iconLeft={<ArrowLeft className="size-3.5" />}
          >
            Zurück
          </Button>
          {!replaceMode && (
            <div className="hidden sm:block text-xs text-ink-muted leading-tight">
              <span className="font-semibold text-ink">
                Gesamt: {(requestedTotalMs / 1000).toFixed(1)}s
              </span>
              {remainingBudgetMs != null && (
                <span className="ml-1.5">
                  · Webcam-Budget: {(remainingBudgetMs / 1000).toFixed(1)}s
                  {!budgetExceeded && remainingBudgetMs > 0 && (
                    <span className="ml-1 text-ink-muted">
                      ({((remainingBudgetMs - requestedTotalMs) / 1000).toFixed(1)}s
                      verfügbar)
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onAdd}
            disabled={!someSelected}
            iconRight={<ArrowRight className="size-4" />}
          >
            {!someSelected
              ? "Keine Folien ausgewählt"
              : replaceMode
                ? "Folie ersetzen"
                : count === 1
                  ? "1 Folie hinzufügen"
                  : `${count} Folien hinzufügen`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SlideCard({
  slide,
  selected,
  durationS,
  onToggleSelect,
  onDurationChange,
}: {
  slide: ImportedSlide;
  selected: boolean;
  durationS: number;
  onToggleSelect: () => void;
  onDurationChange: (s: number) => void;
}) {
  const hasPlaceholders = slide.detectedPlaceholders.length > 0;
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-squircle-md border bg-surface p-2.5 text-left transition-all",
        selected
          ? "border-brand ring-2 ring-brand/30 shadow-card"
          : "border-line hover:border-brand/50",
      )}
    >
      {/* Selektions-Toggle: ganzer Card-Body außer Slider klickt selektiert. */}
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={selected}
        className="absolute inset-0 z-0 rounded-squircle-md focus:outline-none focus:ring-2 focus:ring-brand/30"
        aria-label={`Folie ${slide.slideIndex + 1} ${selected ? "abwählen" : "auswählen"}`}
      />

      {/* Checkbox overlay top-right */}
      <span
        className={cn(
          "pointer-events-none absolute right-3 top-3 z-10 flex size-6 items-center justify-center rounded-full border transition-all",
          selected
            ? "border-brand bg-brand text-white shadow-brand"
            : "border-line bg-surface text-transparent group-hover:border-brand/50",
        )}
        aria-hidden
      >
        <CheckCircle2 className="size-3.5" strokeWidth={3} />
      </span>

      {/* Thumbnail */}
      <div className="relative z-0 aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink pointer-events-none">
        {slide.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={slide.thumbnailUrl}
            alt={`Folie ${slide.slideIndex + 1}`}
            className="absolute inset-0 h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-ink-muted/80 text-[11px]">
            kein Thumbnail
          </div>
        )}
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center justify-center rounded-md bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
          Folie {slide.slideIndex + 1}
        </span>
      </div>

      {/* Platzhalter */}
      <div className="relative z-0 min-h-[24px] pointer-events-none">
        {hasPlaceholders ? (
          <div className="flex flex-wrap gap-1">
            {slide.detectedPlaceholders.slice(0, 4).map((key) => (
              <span
                key={key}
                className="inline-flex items-center rounded-full border border-brand-200 bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-medium text-brand-deep"
                title={`{{${key}}}`}
              >
                {`{{${key}}}`}
              </span>
            ))}
            {slide.detectedPlaceholders.length > 4 && (
              <span className="inline-flex items-center rounded-full border border-line bg-surface-soft px-1.5 py-0.5 text-[10px] text-ink-muted">
                +{slide.detectedPlaceholders.length - 4}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-ink-muted italic">
            Keine Platzhalter gefunden
          </span>
        )}
      </div>

      {/* Per-Folie-Dauer (Slider). Stops Event-Propagation, damit das nicht
          gleichzeitig die Selektion togglet. */}
      <div
        className="relative z-10 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Label
          htmlFor={`canva-dur-${slide.slideIndex}`}
          className="m-0 text-[10px] text-ink-muted uppercase tracking-wide"
        >
          Dauer
        </Label>
        <select
          id={`canva-dur-${slide.slideIndex}`}
          value={durationS}
          onChange={(e) => onDurationChange(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="rounded-squircle-sm border border-line bg-surface px-2 py-1 text-xs font-mono font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {DURATION_OPTIONS_S.map((s) => (
            <option key={s} value={s}>
              {s} s
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
