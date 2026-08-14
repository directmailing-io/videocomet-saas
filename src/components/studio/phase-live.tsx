"use client";

/**
 * phase-live — Phase 3 des Studio-Flows: Standby + Live-Aufnahme.
 *
 * Helles Vollbild: mittig die Bühne als „Browser-Fenster" (Chrome-Leiste mit
 * Szenen-Tabs + REC-Uhr, darunter die 16:9-Bühne mit Live-Webcam-PiP), oben
 * der Teleprompter. Ablauf: Standby (exakt die Aufnahme-Ansicht, alles
 * ausprobierbar, ohne Aufnahme) → „Aufnahme starten" → Countdown 3-2-1 →
 * MediaRecorder.start. Beenden per direktem Klick auf „Aufnahme beenden".
 * Tab-Wechsel/Scrollen im Standby ist gefahrlos: logTabSwitch/noteScroll
 * greifen erst nach Aufnahme-Start (t0-Guard im Recorder).
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Minus,
  Pause,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StudioTab } from "@/lib/studio/types";
import type { StudioPipPosition, StudioPipShape } from "./studio-flow";
import { StudioStage } from "./studio-stage";
import { SceneKindIcon } from "./scene-icon";
import {
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
  pipPosition: StudioPipPosition;
  pipShape: StudioPipShape;
  script: string;
  /** Fertige Aufnahme (Blob + Event-Log). */
  onFinished: (rec: StudioRecording) => void;
  /**
   * Zurück zum Technik-Check: regulärer Ausgang im Standby UND
   * Fehler-Ausweg (Aufnahme konnte nicht starten / war leer).
   */
  onBack: () => void;
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
  pipPosition,
  pipShape,
  script,
  onFinished,
  onBack,
}: PhaseLiveProps) {
  // ── Ablauf: standby (Vorschau) → countdown → live (Aufnahme) ─────────
  const [stage, setStage] = React.useState<"standby" | "countdown" | "live">(
    "standby",
  );
  const [countdown, setCountdown] = React.useState(3);

  const [activeTabId, setActiveTabId] = React.useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  /** Scroll-Position pro Szene (bleibt beim Wechsel erhalten). */
  const ratiosRef = React.useRef<Map<string, number>>(new Map());
  const [activeRatio, setActiveRatio] = React.useState(0);

  /** Video-Szenen: Quell-Position (s) pro Szene — Wiedergabe setzt dort fort. */
  const mediaTimesRef = React.useRef<Map<string, number>>(new Map());
  /** Erhöht sich beim Aufnahme-Start → Videos spulen auf den Anfang zurück. */
  const [mediaResetNonce, setMediaResetNonce] = React.useState(0);

  /** Verbrachte Zeit pro Szene (Basis für spätere Auswertungen). */
  const tabMsRef = React.useRef<Map<string, number>>(new Map());
  const lastTickRef = React.useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const startRef = React.useRef<number | null>(null);

  const recorder = useStudioRecorder(onFinished);
  const [stopping, setStopping] = React.useState(false);

  /** Hinweiskarte im Standby (Ablauf-Bullets + KI-Begrüßungs-Tipp) —
   *  wegklickbar, lokaler State pro Studio-Session reicht. */
  const [hintDismissed, setHintDismissed] = React.useState(false);

  // Der Teleprompter meldet seine Höhe (variiert mit Schriftgröße/hidden),
  // damit die Bühne exakt den restlichen Platz füllt statt zu überlaufen.
  // 184px = Statuszeile + Paddings + Footer (ohne Prompter).
  const hasScript = script.trim().length > 0;
  const [prompterHeight, setPrompterHeight] = React.useState(
    hasScript ? 123 : 0,
  );
  const stageChrome = 184 + (hasScript ? prompterHeight : 0);

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
        "Deine Kamera ist nicht mehr verfügbar. Die Aufnahme konnte nicht starten.",
      );
      return;
    }
    const ok = recorder.start(stream, activeTabIdRef.current);
    if (ok) beginRunning();
  }, [stream, recorder, beginRunning]);

  // Fehlerzustand: „Wird beendet…" darf nie hängen bleiben — bei jedem
  // Recorder-/Start-Fehler (z. B. leere Aufnahme) wieder freigeben und dem
  // Nutzer einen Ausweg zurück zum Technik-Check anbieten.
  const liveError = startError ?? recorder.error;
  React.useEffect(() => {
    if (liveError) setStopping(false);
  }, [liveError]);

  // Countdown 3-2-1 → Aufnahme starten. Bewusst NUR von `stage` abhängig:
  // jede weitere Dependency würde den Intervall bei Re-Renders zurücksetzen
  // und der Countdown käme nie bei 0 an.
  const startRecordingRef = React.useRef(startRecording);
  React.useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);
  React.useEffect(() => {
    if (stage !== "countdown") return;
    setCountdown(3);
    let n = 3;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setStage("live");
        // Der erste tabSwitch der Aufnahme ist die im Standby aktuell
        // gewählte Szene (activeTabIdRef in startRecording).
        startRecordingRef.current();
      } else {
        setCountdown(n);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [stage]);

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
      // Vor Aufnahme-Start (Standby) wirkungslos — t0-Guard im Recorder.
      recorder.logTabSwitch(tabId);
    },
    [tabs, recorder],
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
      recorder.noteScroll(activeTabIdRef.current, clamped);
      setScrollGlow(true);
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      glowTimerRef.current = setTimeout(() => setScrollGlow(false), 450);
    },
    [recorder],
  );
  React.useEffect(() => {
    return () => {
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    };
  }, []);

  // ── Video-Szenen: Play/Pause auf der Bühne ───────────────────────────
  // Im Standby wirkungslos fürs Log (t0-Guard im Recorder), die Position
  // wird trotzdem gemerkt — beim Aufnahme-Start wird alles zurückgesetzt.
  const handleMediaPlayback = React.useCallback(
    (tabId: string, playing: boolean, timeSec: number) => {
      mediaTimesRef.current.set(tabId, timeSec);
      if (playing) recorder.logMediaPlay(tabId);
      else recorder.logMediaPause(tabId);
    },
    [recorder],
  );

  /** Aufnahme starten: Videos zurückspulen, dann Countdown. */
  const startCountdown = React.useCallback(() => {
    mediaTimesRef.current.clear();
    setMediaResetNonce((n) => n + 1);
    setStage("countdown");
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
    setStopping(true);
    recorder.stop();
  }, [recorder]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Statuszeile: Fehler */}
      <div className="flex h-11 shrink-0 items-center justify-center gap-2 px-5">
        {liveError && (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3.5 py-1 text-xs font-medium text-danger">
              <AlertCircle className="size-3.5" />
              {liveError}
            </span>
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-line bg-surface px-3.5 py-1 text-xs font-semibold text-ink shadow-card transition-colors hover:bg-surface-muted"
            >
              Zurück zum Technik-Check
            </button>
          </>
        )}
      </div>

      {/* Teleprompter */}
      {hasScript && (
        <Teleprompter
          script={script}
          stage={stage}
          onHeightChange={setPrompterHeight}
        />
      )}

      {/* Bühne als Browser-Fenster */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-2">
        <div
          className="flex flex-col overflow-hidden rounded-squircle-xl bg-surface shadow-lift"
          style={{
            width: `min(100%, calc((100vh - ${stageChrome}px) * 16 / 9))`,
          }}
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
                    {active && running && (
                      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-danger" />
                    )}
                  </button>
                );
              })}
            </div>

            {stage === "standby" ? (
              <span className="flex shrink-0 items-center self-center rounded-full bg-canvas-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Vorschau
              </span>
            ) : (
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
                mediaStartSec={mediaTimesRef.current.get(activeTab.id)}
                mediaResetNonce={mediaResetNonce}
                onMediaPlayback={(playing, timeSec) =>
                  handleMediaPlayback(activeTab.id, playing, timeSec)
                }
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

            {/* Standby-Hinweiskarte: So läuft die Aufnahme + KI-Tipp.
             * Liegt über der Bühne (z-40, über PiP), die Bedienleiste unten
             * bleibt frei sichtbar und klickbar. */}
            {stage === "standby" && !hintDismissed && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/35 p-6 backdrop-blur-[2px]">
                <div className="max-h-full w-full max-w-md overflow-y-auto rounded-squircle-lg bg-surface p-6 shadow-lift">
                  <h2 className="text-base font-bold text-ink">
                    Kurz bevor es losgeht
                  </h2>
                  <ol className="mt-3 flex flex-col gap-2.5 text-sm leading-snug text-ink-muted">
                    {[
                      "Mit den Tabs oben wechselst du die Szene.",
                      "Auf der Bühne kannst du scrollen. Genau so sieht es dein Empfänger.",
                      'Fertig? Klick unten auf „Aufnahme beenden".',
                    ].map((text, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-canvas-deep text-[10px] font-bold text-ink">
                          {i + 1}
                        </span>
                        {text}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 rounded-squircle-sm bg-brand-soft p-3">
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink">
                      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-deep" />
                      <span>
                        <span className="font-semibold text-brand-deep">
                          Willst du später die persönliche KI-Begrüßung
                          nutzen?
                        </span>{" "}
                        Starte mit einer kurzen Anrede wie „Hi!" und mach
                        danach 1 bis 2 Sekunden Pause. Dort wird später der
                        Vorname eingesetzt.
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHintDismissed(true)}
                    className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm font-bold text-white transition-colors hover:bg-black"
                  >
                    Alles klar
                  </button>
                </div>
              </div>
            )}

            {/* Escape-Hinweis */}
            {escapeHint && (
              <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-line-soft bg-white/85 px-4 py-2 text-xs font-medium text-ink shadow-card backdrop-blur">
                Zum Beenden klick auf „Aufnahme beenden".
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hauptaktion: Standby-Leiste bzw. Beenden per direktem Klick */}
      <footer className="flex shrink-0 items-center justify-center px-5 pb-5 pt-2">
        {stage === "standby" ? (
          <div className="flex w-full max-w-3xl items-center gap-4 rounded-squircle-lg border border-line-soft bg-white/70 px-4 py-3 shadow-card backdrop-blur">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              iconLeft={<ArrowLeft className="size-3.5" />}
            >
              Zurück
            </Button>
            <p className="min-w-0 flex-1 text-xs leading-snug text-ink-muted">
              Das hier ist genau deine Ansicht während der Aufnahme. Wechsle
              Szenen (Klick auf die Tabs oder Tasten 1–9), scrolle auf der
              Bühne, probier alles aus. Die Aufnahme startet erst, wenn du
              klickst.
            </p>
            <Button
              onClick={startCountdown}
              iconLeft={<span className="size-3 rounded-full bg-danger" />}
            >
              Aufnahme starten
            </Button>
          </div>
        ) : stage === "live" ? (
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
        ) : null}
      </footer>

      {/* Countdown */}
      {stage === "countdown" && (
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

/** Sichtbare Zeilen im Teleprompter-Fenster (Höhe = Zeilen × Zeilenhöhe). */
const PROMPTER_VISIBLE_LINES = 3.6;
const PROMPTER_LINE_HEIGHT = 1.5;

/**
 * Teleprompter v2 — dunkler, halbtransparenter Balken über der Bühne mit
 * echtem Auto-Scroll:
 *
 *   • Text scrollt rAF-basiert langsam nach oben, Tempo in Stufen 1–5
 *     (px/s skaliert mit der Schriftgröße, damit „Stufe 3" bei jeder
 *     Textgröße gleich viele Zeilen pro Sekunde bedeutet).
 *   • Beim Wechsel in stage==="live" startet das Scrollen automatisch von
 *     oben; im Standby kann man es zum Üben manuell starten (Play/Pause).
 *   • Weiche Fade-Kanten oben/unten via CSS-Masken, Schriftgröße +/- und
 *     „Ausblenden" bleiben erhalten.
 */
function Teleprompter({
  script,
  stage,
  onHeightChange,
}: {
  script: string;
  stage: "standby" | "countdown" | "live";
  /** Meldet die aktuelle Balken-Höhe (px), damit die Bühne exakt passt. */
  onHeightChange?: (px: number) => void;
}) {
  const [hidden, setHidden] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [speedLevel, setSpeedLevel] = React.useState(3); // 1..5
  const [fontSize, setFontSize] = React.useState(22); // px, 16..32

  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const offsetRef = React.useRef(0);
  const speedRef = React.useRef(speedLevel);
  const fontRef = React.useRef(fontSize);
  React.useEffect(() => {
    speedRef.current = speedLevel;
  }, [speedLevel]);
  React.useEffect(() => {
    fontRef.current = fontSize;
  }, [fontSize]);

  const resetScroll = React.useCallback(() => {
    offsetRef.current = 0;
    if (contentRef.current) {
      contentRef.current.style.transform = "translateY(0px)";
    }
  }, []);

  // Aufnahme läuft → Teleprompter von vorn und automatisch mitscrollen.
  React.useEffect(() => {
    if (stage === "live") {
      resetScroll();
      setPlaying(true);
    }
  }, [stage, resetScroll]);

  React.useEffect(() => {
    if (hidden || !playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // dt kappen: nach Tab-Wechsel/Frame-Drops keinen Sprung machen.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const content = contentRef.current;
      const viewport = viewportRef.current;
      if (content && viewport) {
        const max = Math.max(0, content.scrollHeight - viewport.clientHeight);
        // Zeilen/Sekunde statt fixer px/s: Stufe 3 ≈ eine Zeile alle ~2,2 s.
        const pxPerSec =
          fontRef.current * PROMPTER_LINE_HEIGHT * speedRef.current * 0.15;
        offsetRef.current = Math.min(max, offsetRef.current + pxPerSec * dt);
        content.style.transform = `translateY(${-offsetRef.current}px)`;
        if (offsetRef.current >= max) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hidden, playing]);

  const lineHeightPx = fontSize * PROMPTER_LINE_HEIGHT;
  const viewportHeight = Math.round(lineHeightPx * PROMPTER_VISIBLE_LINES);

  // Höhe an den Parent melden (Balken + pb-1); im hidden-Zustand nur der
  // kleine „einblenden"-Pill.
  React.useEffect(() => {
    onHeightChange?.(hidden ? 28 : viewportHeight + 4);
  }, [hidden, viewportHeight, onHeightChange]);

  const togglePlay = React.useCallback(() => {
    setPlaying((was) => {
      if (was) return false;
      // Am Ende angekommen? Dann von vorn starten.
      const content = contentRef.current;
      const viewport = viewportRef.current;
      if (content && viewport) {
        const max = Math.max(0, content.scrollHeight - viewport.clientHeight);
        if (offsetRef.current >= max) resetScroll();
      }
      return true;
    });
  }, [resetScroll]);

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

  const fadeMask =
    "linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)";

  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center gap-2 px-5 pb-1">
      {/* Prompter-Balken: dunkel, halbtransparent, Fade oben/unten */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-squircle-lg bg-ink/85 shadow-lift backdrop-blur">
        <div
          ref={viewportRef}
          className="overflow-hidden px-8"
          style={{
            height: viewportHeight,
            maskImage: fadeMask,
            WebkitMaskImage: fadeMask,
          }}
        >
          <div
            ref={contentRef}
            className="whitespace-pre-wrap text-center font-medium text-white will-change-transform"
            style={{
              fontSize,
              lineHeight: PROMPTER_LINE_HEIGHT,
              // Erste Zeile startet unter der oberen Fade-Kante, unten genug
              // Auslauf, damit die letzte Zeile bis zur Mitte scrollen kann.
              paddingTop: Math.round(lineHeightPx * 0.6),
              paddingBottom: Math.round(lineHeightPx * 2),
            }}
          >
            {script}
          </div>
        </div>
      </div>

      {/* Steuerung: Play/Pause, Tempo, Schriftgröße, Ausblenden */}
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <button
          type="button"
          aria-label={playing ? "Scrollen pausieren" : "Scrollen starten"}
          onClick={togglePlay}
          className="flex size-8 items-center justify-center rounded-full bg-ink text-white shadow-card transition-colors hover:bg-black"
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 translate-x-px fill-current" />
          )}
        </button>
        <div className="flex items-center gap-1" title="Tempo">
          <button
            type="button"
            aria-label="Langsamer"
            onClick={() => setSpeedLevel((s) => Math.max(1, s - 1))}
            className="rounded-full bg-white/80 p-1 text-ink-muted shadow-card transition-colors hover:bg-white hover:text-ink"
          >
            <Minus className="size-3" />
          </button>
          <span className="w-9 text-center text-[9px] font-medium leading-tight text-ink-muted">
            Tempo
            <br />
            <span className="text-[10px] font-semibold tabular-nums text-ink">
              {speedLevel}
            </span>
          </span>
          <button
            type="button"
            aria-label="Schneller"
            onClick={() => setSpeedLevel((s) => Math.min(5, s + 1))}
            className="rounded-full bg-white/80 p-1 text-ink-muted shadow-card transition-colors hover:bg-white hover:text-ink"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <div className="flex items-center gap-1" title="Schriftgröße">
          <button
            type="button"
            aria-label="Schrift kleiner"
            onClick={() => setFontSize((s) => Math.max(16, s - 2))}
            className="rounded-full bg-white/80 p-1 text-ink-muted shadow-card transition-colors hover:bg-white hover:text-ink"
          >
            <Minus className="size-3" />
          </button>
          <span className="w-9 text-center text-[9px] font-medium leading-tight text-ink-muted">
            Schrift
            <br />
            <span className="text-[10px] font-semibold tabular-nums text-ink">
              {fontSize}
            </span>
          </span>
          <button
            type="button"
            aria-label="Schrift größer"
            onClick={() => setFontSize((s) => Math.min(32, s + 2))}
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
