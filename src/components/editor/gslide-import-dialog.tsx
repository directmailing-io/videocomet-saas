"use client";

import * as React from "react";
import {
  Presentation,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GSlideSegment } from "@/lib/segments/types";
import { createGSlideSegment } from "@/lib/segments/defaults";

/**
 * Multi-Step-Dialog zum Importieren von Google-Slides-Folien.
 *
 * Schritte:
 *   1. Anleitung + URL-Eingabe.
 *   2. Folien-Auswahl (Grid mit Thumbnails + Platzhalter-Pillen).
 *
 * Bei Erfolg erzeugt der Dialog für jede ausgewählte Folie ein
 * `gslide`-Segment via Factory und reicht es per `onAddSegments`
 * an den Wizard zurück.
 */

export interface GSlideImportDialogProps {
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
  onAddSegments: (segments: GSlideSegment[]) => void;
}

interface ImportedSlide {
  slideIndex: number;
  thumbnailUrl: string;
  detectedPlaceholders: string[];
}

interface ImportSuccess {
  mode: "edit" | "pubembed";
  placeholdersSubstitutable: boolean;
  slides: ImportedSlide[];
}

type ImportError =
  | "invalid_url"
  | "not_published"
  | "fetch_timeout"
  | "unknown";

const DURATION_OPTIONS_S = [2, 3, 4, 5, 6, 8, 10, 15] as const;
const DEFAULT_DURATION_S = 4;

function isPlausibleUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Erkennt eine Legacy-Pubembed-URL (`/d/e/<hash>/pubembed|pub|embed`).
 * Wenn ja, warnen wir VOR dem Submit, dass Platzhalter nicht ersetzt
 * werden — der User soll auf den neuen „Anyone with link"-Flow umsteigen.
 */
function looksLikePubembedUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    if (!u.hostname.endsWith("docs.google.com")) return false;
    return /\/presentation\/d\/e\/[^/]+\/(pubembed|pub|embed)/.test(u.pathname);
  } catch {
    return false;
  }
}

function errorMessage(code: ImportError | string | null): string {
  switch (code) {
    case "not_published":
      return 'Wir konnten das Deck nicht laden. Stelle sicher, dass es per „Teilen → Jeder mit dem Link → Betrachter" freigegeben ist.';
    case "invalid_url":
      return "Diese URL kennen wir nicht. Sie sollte mit https://docs.google.com/presentation/d/... beginnen.";
    case "fetch_timeout":
      return "Folien konnten nicht geladen werden. Bitte erneut versuchen.";
    default:
      return "Etwas ist schiefgegangen. Bitte erneut versuchen.";
  }
}

export function GSlideImportDialog({
  open,
  onOpenChange,
  remainingBudgetMs,
  minPerSegmentMs,
  onAddSegments,
}: GSlideImportDialogProps) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [slides, setSlides] = React.useState<ImportedSlide[]>([]);
  const [importMode, setImportMode] = React.useState<"edit" | "pubembed">(
    "edit",
  );
  const [placeholdersSubstitutable, setPlaceholdersSubstitutable] =
    React.useState(true);
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(
    new Set(),
  );
  const [durationS, setDurationS] = React.useState<number>(DEFAULT_DURATION_S);

  // Reset beim Schließen, damit ein erneutes Öffnen frisch startet.
  React.useEffect(() => {
    if (!open) {
      // kleine Defer-Routine: wir wollen Reset NICHT mitten in der
      // Schließanimation sehen (würde Glitch verursachen).
      const t = setTimeout(() => {
        setStep(1);
        setUrl("");
        setLoading(false);
        setErrorCode(null);
        setSlides([]);
        setImportMode("edit");
        setPlaceholdersSubstitutable(true);
        setSelectedIndices(new Set());
        setDurationS(DEFAULT_DURATION_S);
      }, 180);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const trimmedUrl = url.trim();
  const pubembedDetected = looksLikePubembedUrl(trimmedUrl);
  const submitDisabled = loading || !isPlausibleUrl(trimmedUrl);

  async function handleImport() {
    if (submitDisabled) return;
    setLoading(true);
    setErrorCode(null);
    try {
      const res = await fetch("/api/gslides/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishedUrl: trimmedUrl }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const parsed = (await res.json()) as { error?: string };
          if (parsed?.error) code = parsed.error;
        } catch {
          // Body war kein JSON.
        }
        setErrorCode(code ?? (res.status === 502 ? "fetch_timeout" : "unknown"));
        return;
      }
      const data = (await res.json()) as ImportSuccess;
      if (!Array.isArray(data.slides) || data.slides.length === 0) {
        setErrorCode("unknown");
        return;
      }
      setImportMode(data.mode ?? "pubembed");
      setPlaceholdersSubstitutable(data.placeholdersSubstitutable ?? false);
      setSlides(data.slides);
      // Vor-Selektion: alle Folien, die mindestens einen Platzhalter haben —
      // das deckt 90% der Use-Cases ab (Slides ohne Platzhalter werden meist
      // nicht aufgenommen, weil sie nichts personalisieren).
      const preSelected = new Set<number>();
      for (const s of data.slides) {
        if (s.detectedPlaceholders.length > 0) preSelected.add(s.slideIndex);
      }
      // Fallback: wenn KEINE Folie Platzhalter hatte → alle markieren.
      if (preSelected.size === 0) {
        for (const s of data.slides) preSelected.add(s.slideIndex);
      }
      setSelectedIndices(preSelected);
      setStep(2);
    } catch {
      setErrorCode("fetch_timeout");
    } finally {
      setLoading(false);
    }
  }

  function toggleSlide(idx: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIndices.size === slides.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(slides.map((s) => s.slideIndex)));
    }
  }

  function handleAdd() {
    if (selectedIndices.size === 0) return;
    const durationMs = Math.max(minPerSegmentMs, durationS * 1000);
    const orderedSlides = [...slides].sort(
      (a, b) => a.slideIndex - b.slideIndex,
    );
    const chosen = orderedSlides.filter((s) =>
      selectedIndices.has(s.slideIndex),
    );
    const created: GSlideSegment[] = chosen.map((s) => {
      const seg = createGSlideSegment({ durationMs });
      return {
        ...seg,
        publishedUrl: trimmedUrl,
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

  // Budget-Check: würden die ausgewählten Folien das verbleibende Budget
  // sprengen? Wir blocken nicht hart, weil der Wizard nochmal cappt, aber
  // wir warnen visuell.
  const requestedTotalMs = selectedIndices.size * durationS * 1000;
  const budgetExceeded =
    remainingBudgetMs != null && requestedTotalMs > remainingBudgetMs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
              <Presentation className="size-5" />
            </span>
            <div>
              <DialogTitle>Google-Slides-Präsentation einbinden</DialogTitle>
              <DialogDescription>
                {step === 1
                  ? "Veröffentliche dein Deck einmalig und füge den Link ein — wir laden alle Folien als Thumbnails."
                  : `${slides.length} Folien gefunden — wähle aus, welche du nutzen möchtest.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === 1 ? (
          <Step1Instructions
            url={url}
            onUrlChange={setUrl}
            pubembedDetected={pubembedDetected}
            loading={loading}
            errorCode={errorCode}
            onCancel={() => onOpenChange(false)}
            onSubmit={handleImport}
            submitDisabled={submitDisabled}
          />
        ) : (
          <Step2Selection
            slides={slides}
            mode={importMode}
            placeholdersSubstitutable={placeholdersSubstitutable}
            selectedIndices={selectedIndices}
            allSelected={allSelected}
            someSelected={someSelected}
            durationS={durationS}
            onDurationChange={setDurationS}
            budgetExceeded={budgetExceeded}
            remainingBudgetMs={remainingBudgetMs}
            requestedTotalMs={requestedTotalMs}
            onToggleSlide={toggleSlide}
            onToggleAll={toggleAll}
            onBack={() => {
              setStep(1);
              setErrorCode(null);
            }}
            onCancel={() => onOpenChange(false)}
            onAdd={handleAdd}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Step 1: Anleitung + URL-Eingabe ─────────────────────────────────────── */

function Step1Instructions({
  url,
  onUrlChange,
  pubembedDetected,
  loading,
  errorCode,
  onCancel,
  onSubmit,
  submitDisabled,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  pubembedDetected: boolean;
  loading: boolean;
  errorCode: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Beim ersten Render Fokus auf das Input-Feld setzen.
  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-5">
      {/* 4-Punkt-Anleitung */}
      <ol className="space-y-2.5">
        {[
          "Öffne deine Google-Slides-Präsentation.",
          <>
            Klicke oben rechts auf{" "}
            <strong className="font-semibold text-ink">Teilen</strong>.
          </>,
          <>
            Stelle den allgemeinen Zugriff auf{" "}
            <strong className="font-semibold text-ink">
              Jeder, der über den Link verfügt
            </strong>{" "}
            → Rolle{" "}
            <strong className="font-semibold text-ink">Betrachter</strong>.
          </>,
          <>
            Klicke auf{" "}
            <strong className="font-semibold text-ink">Link kopieren</strong>{" "}
            und füge ihn hier unten ein.
          </>,
        ].map((text, idx) => (
          <li
            key={idx}
            className="flex items-start gap-3 rounded-squircle-sm border border-line bg-surface-soft px-3 py-2.5"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
              {idx + 1}
            </span>
            <span className="text-sm leading-relaxed text-ink-soft">
              {text}
            </span>
          </li>
        ))}
      </ol>

      {/* URL Input */}
      <div className="space-y-2">
        <Label htmlFor="gslide-url">Freigabe-Link</Label>
        <Input
          ref={inputRef}
          id="gslide-url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://docs.google.com/presentation/d/<DOC_ID>/edit?usp=sharing"
          className="font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitDisabled) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />

        {pubembedDetected && (
          <div className="flex items-start gap-2 rounded-squircle-sm border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn-deep">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <span className="leading-snug">
              Das sieht nach einer alten Veröffentlichungs-URL aus
              (<code className="font-mono">/d/e/…/pubembed</code>). Damit lassen
              sich Platzhalter <strong>nicht</strong> pro Lead ersetzen. Nutze
              lieber den neuen Freigabe-Link (Schritte oben).
            </span>
          </div>
        )}
      </div>

      {/* Server-Error */}
      {errorCode && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <XCircle className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">{errorMessage(errorCode)}</span>
        </div>
      )}

      {/* Info-Banner */}
      <div className="flex items-start gap-2.5 rounded-squircle-sm border border-brand-200 bg-brand-soft px-4 py-3 text-sm text-brand-deep">
        <Info className="size-4 shrink-0 mt-0.5" />
        <span className="leading-snug">
          „Jeder mit dem Link" gibt deinen Inhalt nicht öffentlich frei —
          gesehen wird er nur von Personen, denen du den Link aktiv schickst.
          Wir laden das Deck einmalig, ersetzen Platzhalter wie{" "}
          <code className="font-mono text-xs bg-brand-200/30 px-1 rounded">
            {`{{firstName}}`}
          </code>{" "}
          pro Lead und rendern serverseitig.
        </span>
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          variant="brand"
          onClick={onSubmit}
          disabled={submitDisabled}
          loading={loading}
          iconRight={!loading ? <ArrowRight className="size-4" /> : undefined}
        >
          Folien laden
        </Button>
      </div>
    </div>
  );
}

/* ── Step 2: Folien-Auswahl ──────────────────────────────────────────────── */

function Step2Selection({
  slides,
  mode,
  placeholdersSubstitutable,
  selectedIndices,
  allSelected,
  someSelected,
  durationS,
  onDurationChange,
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
  mode: "edit" | "pubembed";
  placeholdersSubstitutable: boolean;
  selectedIndices: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  durationS: number;
  onDurationChange: (s: number) => void;
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
      {/* Mode-Banner: Pubembed → Warnung, Edit → Erfolg */}
      {mode === "pubembed" || !placeholdersSubstitutable ? (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn-deep">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">
            <strong className="font-semibold">
              Legacy-Veröffentlichung erkannt:
            </strong>{" "}
            Platzhalter wie{" "}
            <code className="font-mono text-xs bg-warn/10 px-1 rounded">
              {`{{firstName}}`}
            </code>{" "}
            werden bei dieser Variante <strong>nicht</strong> pro Lead ersetzt.
            Teile dein Deck stattdessen über{" "}
            <strong>Teilen → Jeder mit dem Link → Betrachter</strong>, um die
            Personalisierung zu aktivieren.
          </span>
        </div>
      ) : (
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
      )}

      {/* Bulk-Aktion + Dauer-Picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-sm border border-line bg-surface-soft px-4 py-3">
        <button
          type="button"
          onClick={onToggleAll}
          className="text-xs font-semibold text-brand-deep hover:text-brand transition-colors"
        >
          {allSelected ? "Auswahl aufheben" : "Alle auswählen"}
        </button>

        <div className="flex items-center gap-2">
          <Label htmlFor="gslide-duration" className="m-0 text-xs">
            Dauer pro Folie
          </Label>
          <select
            id="gslide-duration"
            value={durationS}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            className="rounded-squircle-sm border border-line bg-surface px-3 py-1.5 text-sm font-mono font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {DURATION_OPTIONS_S.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Budget-Hinweis */}
      {budgetExceeded && remainingBudgetMs != null && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-warn" />
          <span className="leading-snug">
            {count} × {durationS}s ={" "}
            <strong className="font-semibold">
              {(requestedTotalMs / 1000).toFixed(1)}s
            </strong>{" "}
            ist mehr als das freie Webcam-Budget von{" "}
            <strong className="font-semibold">
              {(remainingBudgetMs / 1000).toFixed(1)}s
            </strong>
            . Wir kürzen die letzten Folien automatisch, damit alles passt.
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-h-[420px] overflow-y-auto pr-1">
        {slides.map((slide) => {
          const selected = selectedIndices.has(slide.slideIndex);
          return (
            <SlideCard
              key={slide.slideIndex}
              slide={slide}
              selected={selected}
              onClick={() => onToggleSlide(slide.slideIndex)}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          iconLeft={<ArrowLeft className="size-3.5" />}
        >
          Zurück
        </Button>
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
            {count === 0
              ? "Keine Folien ausgewählt"
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
  onClick,
}: {
  slide: ImportedSlide;
  selected: boolean;
  onClick: () => void;
}) {
  const hasPlaceholders = slide.detectedPlaceholders.length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col gap-2 rounded-squircle-md border bg-surface p-2.5 text-left transition-all",
        selected
          ? "border-brand ring-2 ring-brand/30 shadow-card"
          : "border-line hover:border-brand/50 hover:-translate-y-0.5",
      )}
    >
      {/* Checkbox overlay top-right */}
      <span
        className={cn(
          "absolute right-3 top-3 z-10 flex size-6 items-center justify-center rounded-full border transition-all",
          selected
            ? "border-brand bg-brand text-white shadow-brand"
            : "border-line bg-surface text-transparent group-hover:border-brand/50",
        )}
        aria-hidden
      >
        <CheckCircle2 className="size-3.5" strokeWidth={3} />
      </span>

      {/* Thumbnail mit 16:9 schwarzem Background, object-fit:contain */}
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.thumbnailUrl}
          alt={`Folie ${slide.slideIndex + 1}`}
          className="absolute inset-0 h-full w-full object-contain"
          loading="lazy"
        />
        {/* Slide-Nummer overlay bottom-left */}
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center justify-center rounded-md bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
          Folie {slide.slideIndex + 1}
        </span>
      </div>

      {/* Platzhalter-Pillen */}
      <div className="min-h-[24px]">
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
    </button>
  );
}

/* ── Loading-Skeleton (für späteren Refresh-Use-Case wiederverwendbar) ───── */

export function GSlideThumbnailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2 rounded-squircle-md border border-line bg-surface p-2.5">
      <div className="aspect-video w-full rounded-squircle-sm bg-ink/10" />
      <div className="h-3 w-1/2 rounded-full bg-ink/10" />
    </div>
  );
}
