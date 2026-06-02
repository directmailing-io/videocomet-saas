"use client";

import * as React from "react";
import {
  Globe,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Type,
  Plus,
  Sparkles,
  Info,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type Segment,
  type SegmentKind,
} from "@/lib/segments/types";
import {
  createSegment,
  DEFAULT_SEGMENT_DURATION_MS,
} from "@/lib/segments/defaults";
import {
  totalDurationMs,
  formatDuration,
  adjustToFit,
} from "@/lib/segments/duration";
import { PreviewPlayer } from "@/components/editor/preview-player";
import { Timeline } from "@/components/editor/timeline";
import { SegmentEditor } from "@/components/editor/segment-editor";

export interface WizardStep3Props {
  segments: Segment[];
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  webcamUrl: string | null;
  /** Loaded from the media item. */
  webcamDurationSec: number | null;
  /** All media items the user can pick from inside the segment editor. */
  mediaItems: Array<{
    id: string;
    name: string;
    publicUrl: string;
    type: string;
  }>;
  onSegmentsChange: (segments: Segment[]) => void;
  onPipPositionChange: (pos: "bottom-left" | "bottom-right") => void;
  onPipShapeChange: (shape: "square" | "rounded" | "circle") => void;
}

interface AddCard {
  kind: SegmentKind;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const ADD_CARDS: AddCard[] = [
  {
    kind: "slide",
    icon: Sparkles,
    title: "Freie Folie",
    description:
      "Multi-Layer mit Bildern, Formen und Text — alle Google-Fonts, Platzhalter überall, frei platzierbar.",
  },
  {
    kind: "website",
    icon: Globe,
    title: "Website",
    description: "Personalisierte URL pro Empfänger als Vollbild rendern.",
  },
  {
    kind: "image",
    icon: ImageIcon,
    title: "Bild",
    description: "Aus deiner Medien-Bibliothek einsetzen, mit Hintergrund.",
  },
  {
    kind: "video",
    icon: VideoIcon,
    title: "Video",
    description: "Clip einbinden, optional als Browser-Frame stylen.",
  },
  {
    kind: "gdocs",
    icon: FileText,
    title: "Google Docs",
    description: "Öffentliches Doc scrollen oder als Standbild zeigen.",
  },
  {
    kind: "text",
    icon: Type,
    title: "Text (klassisch)",
    description: "Schlanke Textfolie mit Farbe, Größe und Variablen.",
  },
];

/** Mindest-Rest, damit das Add-Segment noch sinnvoll passt. */
const MIN_REMAINING_FOR_ADD_MS = 200;

export function WizardStep3Editor({
  segments,
  pipPosition,
  pipShape,
  webcamUrl,
  webcamDurationSec,
  mediaItems,
  onSegmentsChange,
  onPipPositionChange,
  onPipShapeChange,
}: WizardStep3Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = React.useState(0);

  // Wir bekommen webcamDurationSec evtl. nicht aus den Props (ältere Media-
  // Items wurden ohne durationSec hochgeladen). In dem Fall sniffen wir die
  // Dauer client-seitig aus einem versteckten <video>-Tag.
  const [probedDurationSec, setProbedDurationSec] = React.useState<number | null>(null);
  const effectiveWebcamSec = webcamDurationSec ?? probedDurationSec;
  const webcamDurationMs = effectiveWebcamSec
    ? Math.round(effectiveWebcamSec * 1000)
    : null;

  React.useEffect(() => {
    if (!webcamUrl || webcamDurationSec) return;
    // Chrome's MediaRecorder schreibt keine Duration in den WebM-Container.
    // Workaround: erst loadedmetadata abwarten, dann currentTime auf einen
    // sehr hohen Wert setzen, was den Browser zwingt, bis zum letzten Frame
    // zu seeken — danach ist v.duration korrekt.
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = webcamUrl;
    let resolved = false;
    const finish = (d: number, reason: string) => {
      if (resolved) return;
      if (Number.isFinite(d) && d > 0 && d < 7200) {
        console.log(`[wizard-step3] probed webcam duration=${d}s via=${reason}`);
        setProbedDurationSec(d);
        resolved = true;
      } else {
        console.warn(`[wizard-step3] probe got invalid duration=${d} via=${reason}`);
      }
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        finish(v.duration, "loadedmetadata");
      } else {
        // Infinity -> use seek trick
        v.currentTime = 1e10;
      }
    };
    const onTimeUpdate = () => {
      if (!resolved && Number.isFinite(v.duration) && v.duration > 0) {
        finish(v.duration, "seek-trick");
        v.currentTime = 0;
      }
    };
    const onErr = () => {
      console.error(`[wizard-step3] probe failed for ${webcamUrl}`, v.error);
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onTimeUpdate);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onTimeUpdate);
      v.removeEventListener("error", onErr);
      v.src = "";
    };
  }, [webcamUrl, webcamDurationSec]);

  const total = totalDurationMs(segments);
  const remainingMs =
    webcamDurationMs != null
      ? Math.max(0, webcamDurationMs - total)
      : Number.POSITIVE_INFINITY;
  const canAdd =
    webcamDurationMs == null
      ? false
      : remainingMs >= MIN_REMAINING_FOR_ADD_MS;

  // Webcam ist kürzer als bisherige Segmente: zeigt Warnbanner.
  const webcamShorterThanSegments =
    webcamDurationMs != null && total > webcamDurationMs;

  function addSegment(kind: SegmentKind) {
    if (webcamDurationMs == null) return;
    if (!canAdd) return;
    // Smart-Add: nimm den verbleibenden Rest, wenn weniger als Default frei.
    const durationMs = Math.min(DEFAULT_SEGMENT_DURATION_MS, remainingMs);
    const seg = createSegment(kind, { durationMs });
    onSegmentsChange([...segments, seg]);
    setSelectedId(seg.id);
  }

  function updateSegment(updated: Segment) {
    // Defensive: Falls trotz UI-Caps ein zu großer Wert reinkommt, hier
    // hart auf das Maximum begrenzen.
    let next = updated;
    if (webcamDurationMs != null) {
      const otherSum = segments
        .filter((s) => s.id !== updated.id)
        .reduce((acc, s) => acc + s.durationMs, 0);
      const maxForThis = Math.max(200, webcamDurationMs - otherSum);
      if (updated.durationMs > maxForThis) {
        next = { ...updated, durationMs: maxForThis };
      }
    }
    onSegmentsChange(segments.map((s) => (s.id === next.id ? next : s)));
  }

  function deleteSegment(id: string) {
    onSegmentsChange(segments.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function autoFit() {
    if (!webcamDurationMs) return;
    const next = adjustToFit(segments, webcamDurationMs, "scale");
    onSegmentsChange(next);
  }

  const selectedSegment = segments.find((s) => s.id === selectedId) ?? null;

  // Wenn keine Webcam-Dauer bekannt: Großer Hinweis und kein Editor.
  if (webcamDurationMs == null) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Editor</h2>
          <p className="text-sm text-ink-muted">
            Baue deine Videopräsentation aus einzelnen Segmenten auf.
          </p>
        </div>
        <Card className="p-10 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep mb-4">
            <VideoIcon className="size-6" />
          </span>
          <h3 className="text-base font-semibold text-ink mb-2">
            Wähle erst ein Webcam-Video
          </h3>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Die Dauer der Webcam-Aufnahme bestimmt die maximale Gesamtlänge
            deiner Segmente. Geh zurück zu Schritt 2 und wähle ein Video.
          </p>
        </Card>
      </div>
    );
  }

  // Status-Pill-Farbcoding
  const pillTone: "ok" | "neutral" | "warn" =
    Math.abs(remainingMs) < 100
      ? "ok"
      : webcamShorterThanSegments
      ? "warn"
      : "neutral";

  return (
    <div className="space-y-8">
      {/* Header mit Status-Pill */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Editor</h2>
          <p className="text-sm text-ink-muted max-w-xl">
            Baue deine Videopräsentation. Reihenfolge, Dauer auf
            Millisekunde, PiP-Position und Form lassen sich frei anpassen.
          </p>
        </div>
        <DurationPill
          totalMs={total}
          webcamMs={webcamDurationMs}
          remainingMs={remainingMs}
          tone={pillTone}
        />
      </div>

      {/* Warn-Banner: Webcam ist kürzer als Segmente. */}
      {webcamShorterThanSegments && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-md border border-warn/40 bg-warn/5 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertTriangle className="size-4 text-warn shrink-0" />
            <span className="text-ink">
              Webcam-Dauer ist jetzt kürzer als deine Segmente — bitte
              anpassen, sonst wird das Audio abgeschnitten.
            </span>
          </div>
          <Button size="sm" variant="subtle" onClick={autoFit}>
            Segmente automatisch anpassen
          </Button>
        </div>
      )}

      {/* Info-Banner unter Limit oder perfekt. */}
      {!webcamShorterThanSegments && segments.length > 0 && (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-squircle-md border px-4 py-2.5 text-sm",
            remainingMs < 100
              ? "border-ok/30 bg-ok/5 text-ink"
              : "border-line bg-surface-soft text-ink-muted",
          )}
        >
          {remainingMs < 100 ? (
            <Sparkles className="size-4 text-ok shrink-0" />
          ) : (
            <Info className="size-4 text-ink-muted shrink-0" />
          )}
          <span>
            {remainingMs < 100
              ? "Perfekt — Segmente passen genau zur Webcam-Aufnahme."
              : `Du hast noch ${formatDuration(
                  remainingMs,
                )} freie Zeit am Ende.`}
          </span>
        </div>
      )}

      {/* Add-Segment Cards */}
      <section aria-labelledby="add-segment-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3
            id="add-segment-heading"
            className="text-sm font-semibold text-ink"
          >
            Segment hinzufügen
          </h3>
          {!canAdd && (
            <span className="text-xs text-ink-muted">
              Webcam-Dauer voll ausgenutzt — Segmente kürzen, um Platz zu
              schaffen.
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ADD_CARDS.map((card) => {
            const Icon = card.icon;
            const disabled = !canAdd;
            return (
              <button
                key={card.kind}
                type="button"
                onClick={() => addSegment(card.kind)}
                disabled={disabled}
                title={
                  disabled
                    ? "Webcam-Dauer voll ausgenutzt — bestehende Segmente zuerst kürzen"
                    : `${card.title} hinzufügen`
                }
                className={cn(
                  "group flex flex-col items-start gap-2 text-left rounded-squircle-md border p-4 transition-all",
                  disabled
                    ? "border-line bg-surface-soft opacity-60 cursor-not-allowed"
                    : "border-line bg-surface hover:border-brand hover:shadow-card hover:-translate-y-0.5 active:translate-y-0",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-full transition-colors",
                    disabled
                      ? "bg-ink/5 text-ink-muted"
                      : "bg-brand-soft text-brand-deep group-hover:bg-brand group-hover:text-white",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="text-sm font-semibold text-ink leading-tight">
                  {card.title}
                </span>
                <span className="text-[11px] leading-snug text-ink-muted">
                  {card.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Preview + PiP-Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PreviewPlayer
            segments={segments}
            webcamUrl={webcamUrl}
            webcamDurationSec={effectiveWebcamSec}
            pipPosition={pipPosition}
            pipShape={pipShape}
            sampleData={{
              firstName: "Max",
              lastName: "Mustermann",
              company: "Acme GmbH",
            }}
          />
        </div>

        <div className="space-y-5">
          <div>
            <Label>PiP-Position</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["bottom-left", "bottom-right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onPipPositionChange(pos)}
                  className={cn(
                    "rounded-squircle-md border p-3 text-xs font-medium transition-all",
                    pipPosition === pos
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line text-ink hover:border-brand/50",
                  )}
                >
                  <div className="aspect-video bg-ink/5 rounded-squircle-sm mb-1 relative">
                    <span
                      className={cn(
                        "absolute size-4 rounded-sm bg-brand",
                        pos === "bottom-left"
                          ? "bottom-1 left-1"
                          : "bottom-1 right-1",
                      )}
                    />
                  </div>
                  {pos === "bottom-left" ? "Links" : "Rechts"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>PiP-Form</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(
                [
                  { v: "square", label: "Eckig", radius: "rounded-none" },
                  { v: "rounded", label: "Rund.", radius: "rounded-md" },
                  { v: "circle", label: "Rund", radius: "rounded-full" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onPipShapeChange(opt.v)}
                  className={cn(
                    "rounded-squircle-md border p-2 text-[11px] font-medium transition-all flex flex-col items-center gap-1.5",
                    pipShape === opt.v
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line text-ink hover:border-brand/50",
                  )}
                >
                  <span className={cn("size-6 bg-brand", opt.radius)} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline - Skala ist immer die Webcam-Dauer, damit kein Overflow
          visuell entstehen kann. */}
      <Timeline
        segments={segments}
        currentTimeMs={currentTimeMs}
        totalDurationMs={webcamDurationMs}
        webcamDurationMs={webcamDurationMs}
        selectedSegmentId={selectedId}
        onSelectSegment={setSelectedId}
        onSegmentsChange={onSegmentsChange}
        onSeek={setCurrentTimeMs}
      />

      {/* Aktiver Segment-Editor */}
      {selectedSegment ? (
        <SegmentEditor
          segment={selectedSegment}
          onChange={updateSegment}
          onDelete={() => deleteSegment(selectedSegment.id)}
          mediaItems={mediaItems}
          webcamDurationMs={webcamDurationMs}
          otherSegmentsDurationMs={total - selectedSegment.durationMs}
        />
      ) : segments.length > 0 ? (
        <Card className="p-6 text-center text-sm text-ink-muted">
          Wähle ein Segment in der Timeline aus, um es zu bearbeiten.
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <Plus className="size-6 text-ink-muted mx-auto mb-2" />
          <p className="text-sm text-ink-muted">
            Füge oben ein erstes Segment hinzu, um zu starten.
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * Kompakter Dauer-Status-Pill oben rechts im Header.
 * Zeigt: Summe / Webcam-Dauer / freie Restzeit. Farbcoding:
 * - ok (grün): Restzeit < 100ms → praktisch perfekt befüllt.
 * - neutral (grau): es gibt noch Platz.
 * - warn (rot): Segmente sind länger als Webcam (sollte nicht passieren,
 *   aber als Sicherheitsnetz).
 */
function DurationPill({
  totalMs,
  webcamMs,
  remainingMs,
  tone,
}: {
  totalMs: number;
  webcamMs: number;
  remainingMs: number;
  tone: "ok" | "neutral" | "warn";
}) {
  const toneClass: Record<typeof tone, string> = {
    ok: "border-ok/40 bg-ok/5 text-ink",
    neutral: "border-line bg-surface-soft text-ink",
    warn: "border-warn/50 bg-warn/5 text-ink",
  };
  const dotClass: Record<typeof tone, string> = {
    ok: "bg-ok",
    neutral: "bg-ink-muted",
    warn: "bg-warn",
  };
  const remainingLabel =
    remainingMs <= 0
      ? "voll ausgenutzt"
      : remainingMs < 100
      ? "voll ausgenutzt"
      : `${formatDuration(remainingMs)} frei`;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium",
        toneClass[tone],
      )}
    >
      <span
        aria-hidden
        className={cn("inline-block size-1.5 rounded-full", dotClass[tone])}
      />
      <span className="font-mono tabular-nums">
        Σ {formatDuration(totalMs)}
      </span>
      <span className="text-ink-muted">von</span>
      <span className="font-mono tabular-nums">
        {formatDuration(webcamMs)}
      </span>
      <span className="text-ink-muted">·</span>
      <span className={tone === "ok" ? "text-ok" : "text-ink-muted"}>
        {remainingLabel}
      </span>
    </div>
  );
}
