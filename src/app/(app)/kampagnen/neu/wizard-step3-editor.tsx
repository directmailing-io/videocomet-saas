"use client";

import * as React from "react";
import {
  Video as VideoIcon,
  Plus,
  Sparkles,
  Info,
  AlertTriangle,
  PictureInPicture2,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type CanvaSegment,
  type GSlideSegment,
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
import { segmentStartMs } from "@/lib/segments/timeline";
import { PreviewPlayer } from "@/components/editor/preview-player";
import { Timeline } from "@/components/editor/timeline";
import { SegmentEditor } from "@/components/editor/segment-editor";
import { GSlideImportDialog } from "@/components/editor/gslide-import-dialog";
import { CanvaImportDialog } from "@/components/editor/canva-import-dialog";
import { AddSegmentDialog, SegmentTypeGrid } from "./add-segment-dialog";

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
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [gslideDialogOpen, setGslideDialogOpen] = React.useState(false);
  const [canvaDialogOpen, setCanvaDialogOpen] = React.useState(false);

  // Externer Seek-Befehl an den PreviewPlayer (Timeline-Klick, Segment-Wahl).
  const seekNonceRef = React.useRef(0);
  const [seekRequest, setSeekRequest] = React.useState<{
    ms: number;
    nonce: number;
  } | null>(null);
  const requestSeek = React.useCallback((ms: number) => {
    seekNonceRef.current += 1;
    setSeekRequest({ ms, nonce: seekNonceRef.current });
    setCurrentTimeMs(ms);
  }, []);

  // Container des Segment-Editors — nach Auswahl sanft ins Bild scrollen.
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!selectedId) return;
    const raf = requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

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

  /** Segment auswählen + Vorschau/Timeline auf dessen Anfang springen. */
  const selectSegment = React.useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) {
        const idx = segments.findIndex((s) => s.id === id);
        if (idx >= 0) requestSeek(segmentStartMs(segments, idx));
      }
    },
    [segments, requestSeek],
  );

  function addSegment(kind: SegmentKind) {
    if (webcamDurationMs == null || !canAdd) return;
    // Smart-Add: nimm den verbleibenden Rest, wenn weniger als Default frei.
    const durationMs = Math.min(DEFAULT_SEGMENT_DURATION_MS, remainingMs);
    const seg = createSegment(kind, { durationMs });
    onSegmentsChange([...segments, seg]);
    setSelectedId(seg.id);
    // Vorschau auf den Anfang des neuen Segments springen.
    requestSeek(total);
  }

  /**
   * Auswahl im Segment-Typ-Dialog/-Grid. Google Slides und Canva öffnen
   * eigene Import-Dialoge — leicht verzögert, damit sich der Auswahl-Dialog
   * erst sauber schließen kann (Radix-Focus-Handling).
   */
  function handlePickSegmentType(kind: SegmentKind) {
    setAddDialogOpen(false);
    if (kind === "gslide") {
      window.setTimeout(() => setGslideDialogOpen(true), 180);
      return;
    }
    if (kind === "canva") {
      window.setTimeout(() => setCanvaDialogOpen(true), 180);
      return;
    }
    addSegment(kind);
  }

  /**
   * Wird vom Google-Slides-Import-Dialog aufgerufen. Wir hängen die neuen
   * Segmente an die Liste an, kappen aber pro Segment am verbleibenden
   * Webcam-Budget — sodass die Summe nie das harte Limit überschreitet.
   */
  function handleAddGSlideSegments(newSegs: GSlideSegment[]) {
    if (webcamDurationMs == null) return;
    let remaining = Math.max(0, webcamDurationMs - total);
    const accepted: GSlideSegment[] = [];
    for (const seg of newSegs) {
      if (remaining < MIN_REMAINING_FOR_ADD_MS) break;
      const capped = Math.min(seg.durationMs, remaining);
      // Mindest-Dauer sicherstellen; wenn nicht genug Platz, wird gestoppt.
      if (capped < MIN_REMAINING_FOR_ADD_MS) break;
      accepted.push({ ...seg, durationMs: capped });
      remaining -= capped;
    }
    if (accepted.length === 0) return;
    onSegmentsChange([...segments, ...accepted]);
    // Erstes neues Segment selektieren — gibt dem User direkt visuelles
    // Feedback und macht den Refresh-Button erreichbar.
    setSelectedId(accepted[0].id);
    requestSeek(total);
  }

  /**
   * Wird vom Canva-Import-Dialog aufgerufen. Identisches Smart-Budgeting
   * wie bei GSlide: kappt pro Segment am verbleibenden Webcam-Budget,
   * sodass die Summe nie das harte Limit überschreitet.
   */
  function handleAddCanvaSegments(newSegs: CanvaSegment[]) {
    if (webcamDurationMs == null) return;
    let remaining = Math.max(0, webcamDurationMs - total);
    const accepted: CanvaSegment[] = [];
    for (const seg of newSegs) {
      if (remaining < MIN_REMAINING_FOR_ADD_MS) break;
      const capped = Math.min(seg.durationMs, remaining);
      if (capped < MIN_REMAINING_FOR_ADD_MS) break;
      accepted.push({ ...seg, durationMs: capped });
      remaining -= capped;
    }
    if (accepted.length === 0) return;
    onSegmentsChange([...segments, ...accepted]);
    setSelectedId(accepted[0].id);
    requestSeek(total);
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
  const selectedSegmentIndex = selectedSegment
    ? segments.findIndex((s) => s.id === selectedSegment.id)
    : null;

  // Wenn keine Webcam-Dauer bekannt: Großer Hinweis und kein Editor.
  // (Tritt bei alten Mediathek-Einträgen oder zu schnellem Klicken nach
  //  einem frischen Upload auf, bevor die Dauer-Probe abgeschlossen ist.)
  if (webcamDurationMs == null) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">
            Video gestalten
          </h2>
          <p className="text-sm text-ink-muted">
            Du siehst diesen Schritt, weil du Modus
            <span className="font-semibold text-ink"> „Mit Präsentation"</span>{" "}
            ausgewählt hast.
          </p>
        </div>
        <Card className="p-10 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep mb-4">
            {webcamUrl ? (
              <span className="inline-block size-5 animate-spin rounded-full border-2 border-brand-deep border-t-transparent" />
            ) : (
              <VideoIcon className="size-6" />
            )}
          </span>
          <h3 className="text-base font-semibold text-ink mb-2">
            {webcamUrl
              ? "Webcam-Dauer wird ermittelt …"
              : "Wähle erst ein Webcam-Video"}
          </h3>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            {webcamUrl
              ? "Wir prüfen kurz, wie lange deine Aufnahme ist — das dauert nur einen Moment. Danach kannst du Segmente hinzufügen."
              : "Die Dauer der Webcam-Aufnahme bestimmt die maximale Gesamtlänge deiner Segmente. Geh zurück zu Schritt 1 und wähle ein Video."}
          </p>
        </Card>
      </div>
    );
  }

  // Status-Farbcoding für die Dauer-Anzeige.
  const durationTone: "ok" | "neutral" | "warn" =
    webcamShorterThanSegments
      ? "warn"
      : remainingMs < 100
      ? "ok"
      : "neutral";

  const hasSegments = segments.length > 0;

  return (
    <div className="space-y-8">
      {/* Header mit Dauer-Anzeige */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">
            Video gestalten
          </h2>
          <p className="text-sm text-ink-muted max-w-xl">
            Deine Webcam-Aufnahme läuft durchgehend als kleine Einblendung.
            Daneben zeigst du Inhalte in{" "}
            <span className="font-semibold text-ink">Segmenten</span> —
            Abschnitte wie Folien, Bilder oder Webseiten, die nacheinander
            ablaufen.
          </p>
        </div>
        <DurationSummary
          totalMs={total}
          webcamMs={webcamDurationMs}
          remainingMs={remainingMs}
          tone={durationTone}
        />
      </div>

      {/* Abschnitt: Webcam-Einblendung */}
      <Card className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
            <PictureInPicture2 className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Webcam-Einblendung
            </h3>
            <p className="text-xs text-ink-muted">
              Lege fest, wo und in welcher Form deine Aufnahme im fertigen
              Video erscheint.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <Label>Position</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["bottom-left", "bottom-right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onPipPositionChange(pos)}
                  aria-pressed={pipPosition === pos}
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
                  {pos === "bottom-left" ? "Links unten" : "Rechts unten"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Form</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(
                [
                  { v: "square", label: "Eckig", radius: "rounded-none" },
                  { v: "rounded", label: "Abgerundet", radius: "rounded-md" },
                  { v: "circle", label: "Kreis", radius: "rounded-full" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onPipShapeChange(opt.v)}
                  aria-pressed={pipShape === opt.v}
                  className={cn(
                    "rounded-squircle-md border p-3 text-xs font-medium transition-all flex flex-col items-center gap-2",
                    pipShape === opt.v
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line text-ink hover:border-brand/50",
                  )}
                >
                  <span className={cn("size-7 bg-brand", opt.radius)} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Abschnitt: Präsentation */}
      <section aria-labelledby="presentation-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              id="presentation-heading"
              className="text-sm font-semibold text-ink"
            >
              Präsentation
            </h3>
            <p className="text-xs text-ink-muted">
              {hasSegments
                ? "Vorschau ansehen, Segmente in der Zeitleiste anordnen und per Klick bearbeiten."
                : "Füge dein erstes Segment hinzu — es läuft neben deiner Webcam-Einblendung."}
            </p>
          </div>
          {hasSegments && (
            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              disabled={!canAdd}
              title={
                canAdd
                  ? "Neues Segment hinzufügen"
                  : "Webcam-Dauer voll ausgenutzt — bestehende Segmente zuerst kürzen"
              }
              iconLeft={<Plus className="size-4" />}
            >
              Segment hinzufügen
            </Button>
          )}
        </div>

        {!canAdd && hasSegments && !webcamShorterThanSegments && (
          <p className="text-xs text-ink-muted">
            Webcam-Dauer voll ausgenutzt — kürze ein Segment, um Platz für
            weitere zu schaffen.
          </p>
        )}

        {/* Warn-Banner: Webcam ist kürzer als Segmente. */}
        {webcamShorterThanSegments && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-md border border-warn/40 bg-warn/5 px-4 py-3">
            <div className="flex items-center gap-2.5 text-sm">
              <AlertTriangle className="size-4 text-warn shrink-0" />
              <span className="text-ink">
                Deine Segmente sind zusammen länger als die Webcam-Aufnahme —
                bitte anpassen, sonst wird der Ton abgeschnitten.
              </span>
            </div>
            <Button size="sm" variant="subtle" onClick={autoFit}>
              Automatisch anpassen
            </Button>
          </div>
        )}

        {!hasSegments ? (
          <Card className="p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
                <Sparkles className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  Womit möchtest du starten?
                </p>
                <p className="text-xs text-ink-muted">
                  Du kannst später beliebig viele Segmente hinzufügen und die
                  Reihenfolge ändern.
                </p>
              </div>
            </div>
            <SegmentTypeGrid onSelect={handlePickSegmentType} />
          </Card>
        ) : (
          <>
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
              seekRequest={seekRequest}
              onTimeChange={setCurrentTimeMs}
            />

            {/* Timeline - Skala ist immer die Webcam-Dauer, damit kein
                Overflow visuell entstehen kann. */}
            <Timeline
              segments={segments}
              currentTimeMs={currentTimeMs}
              totalDurationMs={webcamDurationMs}
              webcamDurationMs={webcamDurationMs}
              selectedSegmentId={selectedId}
              onSelectSegment={selectSegment}
              onSegmentsChange={onSegmentsChange}
              onSeek={requestSeek}
            />

            {remainingMs >= 100 && !webcamShorterThanSegments && (
              <div className="flex items-center gap-2.5 rounded-squircle-md border border-line bg-surface-soft px-4 py-2.5 text-sm text-ink-muted">
                <Info className="size-4 shrink-0" />
                <span>
                  Am Ende sind noch {formatDuration(remainingMs)} frei — dort
                  läuft nur deine Webcam-Aufnahme, ohne Segment.
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Abschnitt: Segment bearbeiten */}
      {hasSegments && (
        <section aria-labelledby="segment-edit-heading" className="space-y-3">
          <h3
            id="segment-edit-heading"
            className="text-sm font-semibold text-ink"
          >
            Segment bearbeiten
          </h3>
          {selectedSegment ? (
            <div ref={editorRef}>
              <SegmentEditor
                segment={selectedSegment}
                onChange={updateSegment}
                onDelete={() => deleteSegment(selectedSegment.id)}
                mediaItems={mediaItems}
                webcamDurationMs={webcamDurationMs}
                otherSegmentsDurationMs={total - selectedSegment.durationMs}
                webcamUrl={webcamUrl}
                allSegments={segments}
                currentSegmentIndex={
                  selectedSegmentIndex != null && selectedSegmentIndex >= 0
                    ? selectedSegmentIndex
                    : null
                }
              />
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-ink-muted">
              <MousePointerClick className="mx-auto mb-2 size-5 opacity-60" />
              Klicke ein Segment in der Zeitleiste an, um es hier zu
              bearbeiten.
            </Card>
          )}
        </section>
      )}

      {/* Segment-Typ-Auswahl */}
      <AddSegmentDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSelect={handlePickSegmentType}
      />

      {/* Google-Slides-Import-Dialog. Wird nur gerendert, wenn open=true,
          damit der Reset-Effect im Dialog sauber triggern kann. */}
      <GSlideImportDialog
        open={gslideDialogOpen}
        onOpenChange={setGslideDialogOpen}
        remainingBudgetMs={remainingMs === Number.POSITIVE_INFINITY ? null : remainingMs}
        minPerSegmentMs={MIN_REMAINING_FOR_ADD_MS}
        onAddSegments={handleAddGSlideSegments}
      />

      {/* Canva-Import-Dialog (PPTX-Pipeline). */}
      <CanvaImportDialog
        open={canvaDialogOpen}
        onOpenChange={setCanvaDialogOpen}
        remainingBudgetMs={remainingMs === Number.POSITIVE_INFINITY ? null : remainingMs}
        minPerSegmentMs={MIN_REMAINING_FOR_ADD_MS}
        onAddSegments={handleAddCanvaSegments}
      />
    </div>
  );
}

/** Kurzformat m:ss (ohne Millisekunden) für die Dauer-Anzeige. */
function formatShort(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/**
 * Dauer-Anzeige oben rechts: Fortschrittsbalken „belegt von Webcam-Dauer".
 * Exakte Werte (mit Millisekunden) stehen im title-Tooltip.
 */
function DurationSummary({
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
  const pct = Math.max(
    0,
    Math.min(100, (totalMs / Math.max(1, webcamMs)) * 100),
  );
  const barClass: Record<typeof tone, string> = {
    ok: "bg-ok",
    neutral: "bg-brand",
    warn: "bg-warn",
  };
  const statusLabel =
    tone === "warn"
      ? "zu lang"
      : remainingMs < 100
      ? "voll belegt"
      : `noch ${formatShort(remainingMs)} frei`;

  return (
    <div
      className="w-56 rounded-squircle-md border border-line bg-surface px-4 py-3"
      title={`Segmente: ${formatDuration(totalMs)} · Webcam: ${formatDuration(
        webcamMs,
      )} · Frei: ${formatDuration(Math.max(0, remainingMs))}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-ink">
          {formatShort(totalMs)}{" "}
          <span className="text-ink-muted">/ {formatShort(webcamMs)}</span>
        </span>
        <span
          className={cn(
            "text-[11px] font-medium",
            tone === "warn"
              ? "text-warn"
              : tone === "ok"
              ? "text-ok"
              : "text-ink-muted",
          )}
        >
          {statusLabel}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
        <div
          className={cn("h-full rounded-full transition-all", barClass[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted">
        Segment-Zeit von Webcam-Dauer belegt
      </p>
    </div>
  );
}
