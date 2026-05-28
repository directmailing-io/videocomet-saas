"use client";

import * as React from "react";
import {
  Camera,
  Check,
  Loader2,
  RotateCcw,
  Square,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScrollFrame } from "@/lib/segments/types";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready" }
  | { kind: "countdown"; n: 3 | 2 | 1 }
  | { kind: "recording"; elapsedMs: number }
  | { kind: "done"; frames: ScrollFrame[] };

interface ScrollRecorderModalProps {
  open: boolean;
  onClose: () => void;
  targetUrl: string;
  segmentDurationMs: number;
  initialFrames?: ScrollFrame[];
  onSave: (frames: ScrollFrame[]) => void;
}

interface ScreenshotResult {
  status: "pending" | "running" | "done" | "failed";
  imageUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

const SAMPLE_INTERVAL_MS = 50;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const s = Math.floor(total / 1000);
  const cs = Math.floor((total % 1000) / 10);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}.${String(cs).padStart(2, "0")}`;
}

/**
 * Modal that lets the user record their own scroll movement over a
 * server-rendered full-page screenshot of a Google Doc or website.
 *
 * Pipeline:
 *   1. POST /api/screenshot  -> { jobId }
 *   2. GET  /api/screenshot/<jobId>  (poll until status === "done")
 *   3. Render image in a scrollable viewport (16:9 cap, image stretches to
 *      original doc height).
 *   4. On "Aufnahme starten" -> 3-2-1 countdown -> record scroll for the
 *      segment duration (or until manual stop).
 *   5. On stop -> show summary, "Übernehmen" calls onSave with frames.
 */
export function ScrollRecorderModal({
  open,
  onClose,
  targetUrl,
  segmentDurationMs,
  initialFrames,
  onSave,
}: ScrollRecorderModalProps) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [shot, setShot] = React.useState<ScreenshotResult | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const startTimeRef = React.useRef<number>(0);
  const framesRef = React.useRef<ScrollFrame[]>([]);
  const samplerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafTickRef = React.useRef<number | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (samplerRef.current !== null) {
      clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
    if (autoStopRef.current !== null) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (rafTickRef.current !== null) {
      cancelAnimationFrame(rafTickRef.current);
      rafTickRef.current = null;
    }
    if (countdownRef.current !== null) {
      clearTimeout(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Reset state on modal close
  React.useEffect(() => {
    if (!open) {
      clearTimers();
      framesRef.current = [];
      setPhase({ kind: "loading" });
      setShot(null);
      setJobId(null);
    }
  }, [open, clearTimers]);

  // Kick off screenshot job when modal opens
  React.useEffect(() => {
    if (!open) return;
    if (!targetUrl) {
      setPhase({ kind: "failed", message: "Keine URL angegeben." });
      return;
    }
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const pollStartTime = Date.now();
    const POLL_TIMEOUT_MS = 60_000;

    const poll = async (id: string) => {
      if (Date.now() - pollStartTime > POLL_TIMEOUT_MS) {
        setPhase({
          kind: "failed",
          message:
            "Vorschau-Erzeugung dauerte zu lange. Der Worker antwortet nicht.",
        });
        return;
      }
      try {
        const res = await fetch(`/api/screenshot/${id}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok) {
          setPhase({
            kind: "failed",
            message: `Vorschau konnte nicht geladen werden (HTTP ${res.status}).`,
          });
          return;
        }
        const data = (await res.json()) as ScreenshotResult;
        if (cancelled) return;
        if (data.status === "done") {
          setShot(data);
          setPhase({ kind: "ready" });
          return;
        }
        if (data.status === "failed") {
          setPhase({
            kind: "failed",
            message: data.error || "Vorschau-Erzeugung fehlgeschlagen.",
          });
          return;
        }
        pollTimer = setTimeout(() => poll(id), 1000);
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "Netzwerkfehler.",
        });
      }
    };

    const start = async () => {
      try {
        setPhase({ kind: "loading" });
        const res = await fetch("/api/screenshot", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl }),
        });
        if (cancelled) return;
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* ignore */
          }
          setPhase({ kind: "failed", message: msg });
          return;
        }
        const j = (await res.json()) as { jobId: string };
        setJobId(j.jobId);
        void poll(j.jobId);
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "Netzwerkfehler.",
        });
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [open, targetUrl]);

  const beginRecording = React.useCallback(() => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollTop = 0;
    framesRef.current = [];

    let count: 3 | 2 | 1 = 3;
    setPhase({ kind: "countdown", n: count });
    const step = () => {
      if (count === 1) {
        startActualRecording();
        return;
      }
      count = (count - 1) as 2 | 1;
      setPhase({ kind: "countdown", n: count });
      countdownRef.current = setTimeout(step, 800);
    };
    countdownRef.current = setTimeout(step, 800);
  }, []);

  const sampleNow = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const t = performance.now() - startTimeRef.current;
    const max = el.scrollHeight - el.clientHeight;
    const y = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    const arr = framesRef.current;
    const last = arr[arr.length - 1];
    if (last && Math.abs(last.y - y) < 0.001 && t - last.t < 200) {
      // Skip near-duplicate sample when user is idle.
      return;
    }
    arr.push({ t, y });
  }, []);

  const stopRecording = React.useCallback(() => {
    clearTimers();
    // Ensure trailing frame at exact stop time.
    sampleNow();
    setPhase({ kind: "done", frames: framesRef.current });
  }, [clearTimers, sampleNow]);

  const startActualRecording = () => {
    if (!viewportRef.current) return;
    startTimeRef.current = performance.now();
    framesRef.current = [{ t: 0, y: 0 }];
    setPhase({ kind: "recording", elapsedMs: 0 });

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setPhase({ kind: "recording", elapsedMs: elapsed });
      rafTickRef.current = requestAnimationFrame(tick);
    };
    rafTickRef.current = requestAnimationFrame(tick);

    samplerRef.current = setInterval(sampleNow, SAMPLE_INTERVAL_MS);
    autoStopRef.current = setTimeout(stopRecording, segmentDurationMs);
  };

  // Sample on scroll events too (so user motion is captured immediately).
  React.useEffect(() => {
    if (phase.kind !== "recording") return;
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => sampleNow();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [phase.kind, sampleNow]);

  // Cleanup on unmount
  React.useEffect(() => clearTimers, [clearTimers]);

  // If user re-opens with existing frames, keep them visible as a hint.
  const initialHint = React.useMemo(() => {
    if (!initialFrames || initialFrames.length === 0) return null;
    const lastT = initialFrames[initialFrames.length - 1]?.t ?? 0;
    return `Vorherige Aufnahme: ${initialFrames.length} Frames, ${formatMs(lastT)} lang.`;
  }, [initialFrames]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (phase.kind === "recording" || phase.kind === "countdown") {
            const ok = window.confirm(
              "Aufnahme läuft. Abbrechen und Daten verwerfen?",
            );
            if (!ok) return;
          }
          clearTimers();
          onClose();
        }
      }}
    >
      <DialogContent
        size="xl"
        className="max-w-4xl w-[min(96vw,1024px)] max-h-[90vh] grid-rows-[auto_1fr_auto]"
      >
        <div>
          <DialogTitle>Scroll-Aufnahme</DialogTitle>
          <DialogDescription>
            Scrolle frei durch das Dokument. Deine Bewegung wird 1:1
            aufgezeichnet und beim Render abgespielt.
          </DialogDescription>
          {initialHint && phase.kind === "ready" && (
            <p className="mt-2 text-xs text-ink-muted">{initialHint}</p>
          )}
        </div>

        <ViewportArea
          phase={phase}
          shot={shot}
          viewportRef={viewportRef}
          segmentDurationMs={segmentDurationMs}
          onRetry={() => {
            setJobId(null);
            setShot(null);
            setPhase({ kind: "loading" });
            // Trigger reload via useEffect by toggling targetUrl dep: simplest
            // is to directly re-invoke the screenshot creation here.
            void (async () => {
              try {
                const res = await fetch("/api/screenshot", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: targetUrl }),
                });
                if (!res.ok) {
                  setPhase({
                    kind: "failed",
                    message: `HTTP ${res.status}`,
                  });
                  return;
                }
                const j = (await res.json()) as { jobId: string };
                setJobId(j.jobId);
                const poll = async () => {
                  const r = await fetch(`/api/screenshot/${j.jobId}`);
                  if (!r.ok) {
                    setPhase({
                      kind: "failed",
                      message: `HTTP ${r.status}`,
                    });
                    return;
                  }
                  const d = (await r.json()) as ScreenshotResult;
                  if (d.status === "done") {
                    setShot(d);
                    setPhase({ kind: "ready" });
                  } else if (d.status === "failed") {
                    setPhase({
                      kind: "failed",
                      message: d.error || "Fehler.",
                    });
                  } else {
                    setTimeout(poll, 1000);
                  }
                };
                void poll();
              } catch (err) {
                setPhase({
                  kind: "failed",
                  message:
                    err instanceof Error ? err.message : "Netzwerkfehler.",
                });
              }
            })();
          }}
        />

        <Controls
          phase={phase}
          segmentDurationMs={segmentDurationMs}
          onStart={beginRecording}
          onStop={stopRecording}
          onSave={() => {
            if (phase.kind === "done") {
              onSave(phase.frames);
              clearTimers();
              onClose();
            }
          }}
          onRestart={() => {
            framesRef.current = [];
            setPhase({ kind: "ready" });
            if (viewportRef.current) viewportRef.current.scrollTop = 0;
          }}
          onCancel={() => {
            if (phase.kind === "recording" || phase.kind === "countdown") {
              const ok = window.confirm(
                "Aufnahme läuft. Abbrechen und Daten verwerfen?",
              );
              if (!ok) return;
            }
            clearTimers();
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ViewportArea({
  phase,
  shot,
  viewportRef,
  segmentDurationMs,
}: {
  phase: Phase;
  shot: ScreenshotResult | null;
  viewportRef: React.MutableRefObject<HTMLDivElement | null>;
  segmentDurationMs: number;
  onRetry: () => void;
}) {
  if (phase.kind === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-squircle-md border border-dashed border-line bg-surface-soft py-20">
        <Loader2 className="size-6 animate-spin text-brand-deep" />
        <p className="text-sm text-ink-muted">
          Lade Vorschau des Dokuments…
        </p>
        <p className="text-xs text-ink-muted">
          Dies kann 5–15 Sekunden dauern.
        </p>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-squircle-md border border-dashed border-danger/40 bg-danger/5 py-12 px-6 text-center">
        <AlertCircle className="size-6 text-danger" />
        <p className="text-sm font-semibold text-ink">
          Vorschau konnte nicht geladen werden
        </p>
        <p className="text-xs text-ink-muted max-w-md">{phase.message}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* progress bar during recording */}
      {phase.kind === "recording" && (
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-line">
          <div
            className="h-full bg-brand transition-[width] duration-100"
            style={{
              width: `${Math.min(100, (phase.elapsedMs / segmentDurationMs) * 100)}%`,
            }}
          />
        </div>
      )}

      <div
        ref={viewportRef}
        className={cn(
          "aspect-video w-full overflow-auto rounded-squircle-md border border-line bg-white",
          phase.kind === "countdown" && "overflow-hidden",
        )}
      >
        {shot?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.imageUrl}
            alt="Dokument-Vorschau"
            className="block w-full h-auto select-none"
            draggable={false}
          />
        )}
      </div>

      {/* countdown overlay */}
      {phase.kind === "countdown" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/40 backdrop-blur-sm rounded-squircle-md">
          <div className="text-white text-8xl font-bold drop-shadow-lg">
            {phase.n}
          </div>
        </div>
      )}

      {/* recording badge */}
      {phase.kind === "recording" && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-full bg-danger px-3 py-1.5 text-white text-xs font-semibold shadow-lift">
          <span className="size-2 rounded-full bg-white animate-pulse" />
          REC {formatMs(phase.elapsedMs)} / {formatMs(segmentDurationMs)}
        </div>
      )}
    </div>
  );
}

function Controls({
  phase,
  segmentDurationMs,
  onStart,
  onStop,
  onSave,
  onRestart,
  onCancel,
}: {
  phase: Phase;
  segmentDurationMs: number;
  onStart: () => void;
  onStop: () => void;
  onSave: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  if (phase.kind === "loading") {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Schliessen
        </Button>
      </div>
    );
  }
  if (phase.kind === "ready") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          Max. Aufnahme-Dauer: {formatMs(segmentDurationMs)}
        </p>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            onClick={onStart}
            iconLeft={<Camera className="size-4" />}
          >
            Aufnahme starten
          </Button>
        </div>
      </div>
    );
  }
  if (phase.kind === "countdown") {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    );
  }
  if (phase.kind === "recording") {
    return (
      <div className="flex justify-between items-center gap-3">
        <p className="text-xs text-ink-muted">
          Scrolle frei. Auto-Stop bei {formatMs(segmentDurationMs)}.
        </p>
        <Button
          variant="danger"
          onClick={onStop}
          iconLeft={<Square className="size-4" />}
        >
          Aufnahme stoppen
        </Button>
      </div>
    );
  }
  if (phase.kind === "done") {
    const lastT = phase.frames[phase.frames.length - 1]?.t ?? 0;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {phase.frames.length} Frames aufgezeichnet, {formatMs(lastT)} lang.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onRestart}
            iconLeft={<RotateCcw className="size-4" />}
          >
            Erneut aufnehmen
          </Button>
          <Button onClick={onSave} iconLeft={<Check className="size-4" />}>
            Übernehmen
          </Button>
        </div>
      </div>
    );
  }
  return null;
}
