"use client";

/**
 * phase-live — Phase 3 des Studio-Flows: die eigentliche Live-Aufnahme.
 *
 * Helles Vollbild: mittig die Bühne als „Browser-Fenster" (Chrome-Leiste mit
 * Szenen-Tabs + REC-Uhr, darunter die 16:9-Bühne mit Live-Webcam-PiP), oben
 * der Teleprompter. Ablauf im Record-Modus: Erstnutzer-Hinweise →
 * Countdown 3-2-1 → MediaRecorder.start. Übungsmodus: identischer Screen
 * ohne Recorder. Beenden per direktem Klick auf „Aufnahme beenden".
 */

import * as React from "react";
import { AlertCircle, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StudioTab } from "@/lib/studio/types";
import type { StudioPipPosition, StudioPipShape } from "./studio-flow";
import { StudioStage } from "./studio-stage";
import { SceneKindIcon } from "./scene-icon";
import {
  STUDIO_HINTS_SEEN_KEY,
  clamp01,
  formatClock,
  sceneKindOf,
  tabLabel,
  tabThumbUrl,
  type StudioRecording,
} from "./internal";
import { useStudioRecorder } from "./use-studio-recorder";

export interface PhaseLiveProps {
  tabs: StudioTab[];
  stream: MediaStream | null;
  mode: "record" | "practice";
  pipPosition: StudioPipPosition;
  pipShape: StudioPipShape;
  script: string;
  /** Record-Modus: fertige Aufnahme (Blob + Event-Log). */
  onFinished: (rec: StudioRecording) => void;
  /**
   * Zurück zum Bereit-Check: regulärer Ausgang im Übungsmodus UND
   * Fehler-Ausweg im Record-Modus (Aufnahme konnte nicht starten / war leer).
   */
  onExitPractice: () => void;
}

function pipPositionClass(pos: StudioPipPosition): string {
  return pos === "bottom-left" ? "bottom-4 left-4" : "bottom-4 right-4";
}

function pipShapeClass(shape: StudioPipShape): string {
  if (shape === "square") return "rounded-none";
  if (shape === "rounded") return "rounded-squircle-md";
  return "rounded-full aspect-square";
}

export function PhaseLive({
  tabs,
  stream,
  mode,
  pipPosition,
  pipShape,
  script,
  onFinished,
  onExitPractice,
}: PhaseLiveProps) {
  const isRecord = mode === "record";

  // ── Overlay-Sequenz: hints → countdown (nur record) → läuft ─────────
  const [overlay, setOverlay] = React.useState<"hints" | "countdown" | null>(
    () => {
      const seen =
        typeof window !== "undefined" &&
        window.localStorage.getItem(STUDIO_HINTS_SEEN_KEY) === "1";
      if (!seen) return "hints";
      return isRecord ? "countdown" : null;
    },
  );
  const [countdown, setCountdown] = React.useState(3);

  const [activeTabId, setActiveTabId] = React.useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  /** Scroll-Position pro Szene (bleibt beim Wechsel erhalten). */
  const ratiosRef = React.useRef<Map<string, number>>(new Map());
  const [activeRatio, setActiveRatio] = React.useState(0);

  /** Verbrachte Zeit pro Szene (Basis für spätere Auswertungen). */
  const tabMsRef = React.useRef<Map<string, number>>(new Map());
  const lastTickRef = React.useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const startRef = React.useRef<number | null>(null);

  const recorder = useStudioRecorder(onFinished);
  const [stopping, setStopping] = React.useState(false);

  const activeTabIdRef = React.useRef(activeTabId);
  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // ── Start-Logik ──────────────────────────────────────────────────────
  const beginRunning = React.useCallback(() => {
    startRef.current = performance.now();
    lastTickRef.current = performance.now();
    setRunning(true);
  }, []);

  /** Start-Fehler außerhalb des Recorders (z. B. Kamera-Stream weg). */
  const [startError, setStartError] = React.useState<string | null>(null);
  const startedRef = React.useRef(false);
  const startRecording = React.useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!stream) {
      setStartError(
        "Deine Kamera ist nicht mehr verfügbar — die Aufnahme konnte nicht starten.",
      );
      return;
    }
    const ok = recorder.start(stream, activeTabIdRef.current);
    if (ok) beginRunning();
  }, [stream, recorder, beginRunning]);

  // Fehlerzustand: „Wird beendet…" darf nie hängen bleiben — bei jedem
  // Recorder-/Start-Fehler (z. B. leere Aufnahme) wieder freigeben und dem
  // Nutzer einen Ausweg zurück zum Bereit-Check anbieten.
  const liveError = startError ?? recorder.error;
  React.useEffect(() => {
    if (liveError) setStopping(false);
  }, [liveError]);

  // Übungsmodus ohne Hints: sofort loslaufen.
  React.useEffect(() => {
    if (!isRecord && overlay === null && !running) beginRunning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Countdown 3-2-1 → Aufnahme starten. Bewusst NUR vom Overlay abhängig:
  // jede weitere Dependency würde den Intervall bei Re-Renders zurücksetzen
  // und der Countdown käme nie bei 0 an.
  const startRecordingRef = React.useRef(startRecording);
  React.useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);
  React.useEffect(() => {
    if (overlay !== "countdown") return;
    setCountdown(3);
    let n = 3;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setOverlay(null);
        startRecordingRef.current();
      } else {
        setCountdown(n);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [overlay]);

  const dismissHints = () => {
    try {
      window.localStorage.setItem(STUDIO_HINTS_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setOverlay(isRecord ? "countdown" : null);
  };

  // ── Uhr + Zeit pro Szene (250-ms-Tick) ───────────────────────────────
  React.useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      const now = performance.now();
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const cur = tabMsRef.current.get(activeTabIdRef.current) ?? 0;
      tabMsRef.current.set(activeTabIdRef.current, cur + (now - last));
      if (startRef.current !== null) setElapsedMs(now - startRef.current);
    }, 250);
    return () => clearInterval(iv);
  }, [running]);

  // ── Szenenwechsel ────────────────────────────────────────────────────
  const switchTab = React.useCallback(
    (tabId: string) => {
      if (tabId === activeTabIdRef.current) return;
      if (!tabs.some((t) => t.id === tabId)) return;
      setActiveTabId(tabId);
      setActiveRatio(ratiosRef.current.get(tabId) ?? 0);
      if (isRecord) recorder.logTabSwitch(tabId);
    },
    [tabs, isRecord, recorder],
  );

  // ── Scroll auf der Bühne ─────────────────────────────────────────────
  const [scrollGlow, setScrollGlow] = React.useState(false);
  const glowTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const handleScrollRatio = React.useCallback(
    (y: number) => {
      const clamped = clamp01(y);
      ratiosRef.current.set(activeTabIdRef.current, clamped);
      setActiveRatio(clamped);
      if (isRecord) recorder.noteScroll(activeTabIdRef.current, clamped);
      setScrollGlow(true);
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      glowTimerRef.current = setTimeout(() => setScrollGlow(false), 450);
    },
    [isRecord, recorder],
  );
  React.useEffect(() => {
    return () => {
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    };
  }, []);

  // ── Tastatur: 1–9, Pfeile, Escape-Hinweis ────────────────────────────
  const [escapeHint, setEscapeHint] = React.useState(false);
  const escapeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        if (tabs[idx]) {
          e.preventDefault();
          switchTab(tabs[idx].id);
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = tabs.findIndex((t) => t.id === activeTabIdRef.current);
        if (cur < 0) return;
        const next =
          e.key === "ArrowRight"
            ? Math.min(tabs.length - 1, cur + 1)
            : Math.max(0, cur - 1);
        switchTab(tabs[next].id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEscapeHint(true);
        if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = setTimeout(() => setEscapeHint(false), 2500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
    };
  }, [tabs, switchTab]);

  // ── Webcam-PiP ───────────────────────────────────────────────────────
  const pipVideoRef = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const v = pipVideoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  // ── Beenden (direkter Klick) ─────────────────────────────────────────
  const stopAll = React.useCallback(() => {
    if (isRecord) {
      setStopping(true);
      recorder.stop();
    } else {
      onExitPractice();
    }
  }, [isRecord, recorder, onExitPractice]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Statuszeile: Übungs-Badge + Fehler */}
      <div className="flex h-11 shrink-0 items-center justify-center gap-2 px-5">
        {!isRecord && (
          <span className="rounded-full bg-warn-soft px-3.5 py-1 text-xs font-semibold text-warn">
            Übungsmodus — es wird nichts aufgenommen
          </span>
        )}
        {liveError && (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3.5 py-1 text-xs font-medium text-danger">
              <AlertCircle className="size-3.5" />
              {liveError}
            </span>
            {isRecord && (
              <button
                type="button"
                onClick={onExitPractice}
                className="rounded-full border border-line bg-surface px-3.5 py-1 text-xs font-semibold text-ink shadow-card transition-colors hover:bg-surface-muted"
              >
                Zurück zum Bereit-Check
              </button>
            )}
          </>
        )}
      </div>

      {/* Teleprompter */}
      {script.trim().length > 0 && <Teleprompter script={script} />}

      {/* Bühne als Browser-Fenster */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-2">
        <div
          className="flex flex-col overflow-hidden rounded-squircle-xl bg-surface shadow-lift"
          style={{ width: "min(100%, calc((100vh - 250px) * 16 / 9))" }}
        >
          {/* Chrome-Leiste: Ampel + Szenen-Tabs + REC */}
          <div className="flex h-11 shrink-0 items-stretch gap-3 border-b border-line-soft bg-surface-soft pl-4 pr-4">
            <span className="flex items-center gap-1.5 self-stretch">
              <span className="size-2.5 rounded-full bg-[#f0b9b4]" />
              <span className="size-2.5 rounded-full bg-[#f0dcae]" />
              <span className="size-2.5 rounded-full bg-[#bcdcc0]" />
            </span>

            <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1.5">
              {tabs.map((tab, i) => {
                const active = tab.id === activeTabId;
                const thumb = tabThumbUrl(tab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => switchTab(tab.id)}
                    className={cn(
                      "flex h-full shrink-0 items-center gap-2 rounded-t-[10px] px-3 transition-colors",
                      active
                        ? "-mb-px border border-b-0 border-line-soft bg-surface"
                        : "text-ink-muted hover:bg-canvas-deep/70",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] font-bold tabular-nums",
                        active ? "text-brand-deep" : "text-ink-muted/70",
                      )}
                    >
                      {i + 1}
                    </span>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        className="h-[18px] w-7 shrink-0 rounded-[4px] object-cover object-top"
                      />
                    ) : tab.segment.kind === "text" ? (
                      <span
                        className="h-[18px] w-7 shrink-0 rounded-[4px] border border-line-soft"
                        style={{ backgroundColor: tab.segment.bgColor }}
                      />
                    ) : (
                      <SceneKindIcon
                        kind={sceneKindOf(tab)}
                        className="size-3.5 shrink-0 text-ink-muted"
                      />
                    )}
                    <span
                      className={cn(
                        "max-w-[130px] truncate text-xs",
                        active
                          ? "font-semibold text-ink"
                          : "font-medium text-ink-muted",
                      )}
                    >
                      {tabLabel(tab)}
                    </span>
                    {active && isRecord && running && (
                      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-danger" />
                    )}
                  </button>
                );
              })}
            </div>

            {isRecord && (
              <span className="flex shrink-0 items-center gap-1.5 self-stretch">
                <span
                  className={cn(
                    "size-2 rounded-full bg-danger",
                    running && "animate-pulse",
                  )}
                />
                <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                  {running ? formatClock(elapsedMs) : "REC"}
                </span>
              </span>
            )}
          </div>

          {/* 16:9-Bühne */}
          <div className="relative aspect-video w-full bg-black">
            {activeTab && (
              <StudioStage
                key={activeTab.id}
                segment={activeTab.segment}
                scrollRatio={activeRatio}
                onScrollRatio={handleScrollRatio}
                showStaticBadge
              />
            )}

            {/* Scroll-Fortschrittslinie an der rechten Bühnenkante */}
            <div
              className={cn(
                "pointer-events-none absolute inset-y-2 right-1 z-20 w-1 rounded-full bg-white/10 transition-opacity duration-300",
                scrollGlow ? "opacity-100" : "opacity-0",
              )}
            >
              <div
                className="absolute left-0 h-10 w-1 rounded-full bg-brand shadow-[0_0_12px_2px_rgba(170,140,245,0.8)]"
                style={{
                  top: `calc(${activeRatio * 100}% - ${activeRatio * 40}px)`,
                }}
              />
            </div>

            {/* Live-Webcam-PiP */}
            <div
              className={cn(
                "pointer-events-none absolute z-30 w-1/4 overflow-hidden border-2 border-white/25 shadow-lift",
                pipPositionClass(pipPosition),
                pipShapeClass(pipShape),
                pipShape !== "circle" && "aspect-video",
              )}
            >
              <video
                ref={pipVideoRef}
                muted
                playsInline
                autoPlay
                className="size-full -scale-x-100 object-cover"
              />
            </div>

            {/* Escape-Hinweis */}
            {escapeHint && (
              <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-line-soft bg-white/85 px-4 py-2 text-xs font-medium text-ink shadow-card backdrop-blur">
                Zum Beenden klick auf „Aufnahme beenden".
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hauptaktion: Beenden per direktem Klick */}
      <footer className="flex shrink-0 items-center justify-center px-5 pb-5 pt-2">
        {isRecord ? (
          <button
            type="button"
            onClick={stopAll}
            disabled={stopping}
            className={cn(
              "flex h-11 items-center gap-2.5 rounded-full bg-ink px-6 text-sm font-bold text-white shadow-ink transition-all",
              stopping
                ? "opacity-60"
                : "hover:-translate-y-0.5 hover:bg-black active:translate-y-0",
            )}
          >
            <span className="size-3 rounded-[3px] bg-danger" />
            {stopping ? "Wird beendet…" : "Aufnahme beenden"}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={stopAll}
            iconLeft={<X className="size-3.5" />}
          >
            Übung beenden
          </Button>
        )}
      </footer>

      {/* Erstnutzer-Hinweise */}
      {overlay === "hints" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur">
          <div className="w-full max-w-md rounded-squircle-xl border border-line-soft bg-surface p-6 shadow-lift">
            <h2 className="mb-4 text-base font-bold text-ink">
              Kurz bevor es losgeht
            </h2>
            <ul className="mb-5 flex flex-col gap-3 text-sm leading-relaxed text-ink-muted">
              <li className="flex gap-2.5">
                <span className="font-bold text-brand-deep">1.</span>
                Wechsle die Szenen oben per Klick auf die Tabs oder mit den
                Tasten 1–9.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-brand-deep">2.</span>
                Scrolle direkt auf der Bühne — genau das sieht dein Empfänger.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-brand-deep">3.</span>
                Zum Beenden klickst du unten auf „Aufnahme beenden".
              </li>
            </ul>
            <div className="flex justify-end">
              <Button onClick={dismissHints}>Alles klar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Countdown */}
      {overlay === "countdown" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur">
          <span
            key={countdown}
            className="animate-in zoom-in text-[140px] font-semibold tracking-tight text-ink duration-300"
          >
            {countdown}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teleprompter                                                        */
/* ------------------------------------------------------------------ */

function Teleprompter({ script }: { script: string }) {
  const [hidden, setHidden] = React.useState(false);
  const [speed, setSpeed] = React.useState(30); // px/s
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const offsetRef = React.useRef(0);
  const speedRef = React.useRef(speed);
  React.useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  React.useEffect(() => {
    if (hidden) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const content = contentRef.current;
      const viewport = viewportRef.current;
      if (content && viewport) {
        const max = Math.max(
          0,
          content.scrollHeight - viewport.clientHeight,
        );
        offsetRef.current = Math.min(
          max,
          offsetRef.current + speedRef.current * dt,
        );
        content.style.transform = `translateY(${-offsetRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hidden]);

  if (hidden) {
    return (
      <div className="flex shrink-0 justify-center pb-1">
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="rounded-full border border-line-soft bg-white/70 px-3 py-1 text-[10px] font-semibold text-ink-muted backdrop-blur transition-colors hover:text-ink"
        >
          Teleprompter einblenden
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-2 px-5 pb-1">
      <div
        ref={viewportRef}
        className="relative h-[3.6em] flex-1 overflow-hidden rounded-squircle-md border border-line-soft bg-white/80 px-4 py-1.5 text-sm leading-relaxed text-ink shadow-card backdrop-blur"
      >
        <div ref={contentRef} className="whitespace-pre-wrap will-change-transform">
          {script}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Langsamer"
            onClick={() => setSpeed((s) => Math.max(10, s - 10))}
            className="rounded-full bg-white/80 p-1 text-ink-muted shadow-card transition-colors hover:bg-white hover:text-ink"
          >
            <Minus className="size-3" />
          </button>
          <span className="w-7 text-center text-[10px] tabular-nums text-ink-muted">
            {speed}
          </span>
          <button
            type="button"
            aria-label="Schneller"
            onClick={() => setSpeed((s) => Math.min(120, s + 10))}
            className="rounded-full bg-white/80 p-1 text-ink-muted shadow-card transition-colors hover:bg-white hover:text-ink"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-[9px] font-medium text-ink-muted/70 hover:text-ink-muted"
        >
          Ausblenden
        </button>
      </div>
    </div>
  );
}
