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
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pause,
  Pencil,
  PictureInPicture2,
  Play,
  Plus,
  Rows3,
  ScrollText,
  Sparkles,
  X,
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
  /** PiP-Wahl passiert hier im Standby, live am echten Kamerabild. */
  onPipPositionChange: (pos: StudioPipPosition) => void;
  onPipShapeChange: (shape: StudioPipShape) => void;
  script: string;
  /** Teleprompter-Text ist im Standby direkt bearbeitbar. */
  onScriptChange: (script: string) => void;
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

const PIP_SHAPE_OPTIONS: { value: StudioPipShape; label: string }[] = [
  { value: "square", label: "Eckig" },
  { value: "rounded", label: "Rund" },
  { value: "circle", label: "Kreis" },
];

export function PhaseLive({
  tabs,
  stream,
  pipPosition,
  pipShape,
  onPipPositionChange,
  onPipShapeChange,
  script,
  onScriptChange,
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

  // Teleprompter ist opt-in: standardmäßig ausgeblendet (nicht jeder will
  // einen), Toggle sitzt oben rechts. Der Prompter meldet seine Höhe
  // (variiert mit der Schriftgröße), damit die Bühne exakt den restlichen
  // Platz füllt. 184px = Statuszeile + Paddings + Footer (ohne Prompter).
  const [prompterVisible, setPrompterVisible] = React.useState(false);
  const [prompterHeight, setPrompterHeight] = React.useState(123);
  // Overlay-Modus: Prompter schwebt über der Bühne statt darüber anzudocken
  // (User-Wahl, gemerkt über Studio-Sessions hinweg).
  const [prompterOverlay, setPrompterOverlay] = React.useState(false);
  React.useEffect(() => {
    try {
      setPrompterOverlay(localStorage.getItem("vc-prompter-overlay") === "1");
    } catch {
      // localStorage gesperrt → Default (angedockt) behalten.
    }
  }, []);
  const togglePrompterOverlay = React.useCallback(() => {
    setPrompterOverlay((v) => {
      const next = !v;
      try {
        localStorage.setItem("vc-prompter-overlay", next ? "1" : "0");
      } catch {
        // Ignorieren — dann gilt die Wahl nur für diese Session.
      }
      return next;
    });
  }, []);
  const stageChrome =
    184 + (prompterVisible && !prompterOverlay ? prompterHeight : 0);

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

  // ── Tastatur: 1–9 = Szenen, Escape-Hinweis ───────────────────────────
  // Die Pfeiltasten gehören komplett dem Teleprompter (←/→ Tempo, ↑/↓
  // zeilenweise scrollen) — Szenen wechseln nur per Klick oder Ziffern.
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
      {/* Statuszeile: Fehler mittig, Teleprompter-Toggle rechts */}
      <div className="relative flex h-11 shrink-0 items-center justify-center gap-2 px-5">
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
        <button
          type="button"
          onClick={() => setPrompterVisible((v) => !v)}
          className={cn(
            "absolute right-5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
            prompterVisible
              ? "bg-brand-soft text-brand-deep"
              : "text-ink-muted hover:bg-canvas-deep hover:text-ink",
          )}
        >
          <ScrollText className="size-3.5" />
          Teleprompter
        </button>
      </div>

      {/* Teleprompter (opt-in, angedockt über der Bühne) */}
      {prompterVisible && !prompterOverlay && (
        <Teleprompter
          script={script}
          stage={stage}
          overlay={false}
          onToggleOverlay={togglePrompterOverlay}
          onScriptChange={onScriptChange}
          onHide={() => setPrompterVisible(false)}
          onHeightChange={setPrompterHeight}
        />
      )}

      {/* Bühne als Browser-Fenster, im Standby mit Kamera-Sidebar rechts */}
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4 px-5 py-2">
        <div
          className="flex min-w-0 flex-col overflow-hidden rounded-squircle-xl bg-surface shadow-lift"
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

            {/* Teleprompter im Overlay-Modus: schwebt über der Bühne,
             * Wheel/Klicks gehen durch (pointer-events-none im Prompter),
             * nur die Steuerleiste bleibt bedienbar. */}
            {prompterVisible && prompterOverlay && (
              <Teleprompter
                script={script}
                stage={stage}
                overlay
                onToggleOverlay={togglePrompterOverlay}
                onScriptChange={onScriptChange}
                onHide={() => setPrompterVisible(false)}
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
                      "Auf der Bühne kannst du scrollen. Genau so sieht es dein Lead — scroll möglichst langsam, dann wirkt das Video flüssig.",
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

        {/* Kamera-Sidebar (nur Standby): Position + Form des Webcam-PiP,
         * rechts neben dem Video statt als Overlay darin — Wirkung sofort
         * live am echten Kamerabild sichtbar. */}
        {stage === "standby" && (
          <aside className="hidden w-48 shrink-0 flex-col gap-5 self-center rounded-squircle-lg border border-line-soft bg-white/80 p-4 shadow-card backdrop-blur md:flex">
            <div>
              <p className="text-sm font-bold text-ink">Dein Kamerabild</p>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                Änderungen siehst du sofort in der Vorschau.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Position
              </span>
              {(["bottom-left", "bottom-right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onPipPositionChange(pos)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-squircle-sm border px-3 py-2 text-xs font-semibold transition-colors",
                    pipPosition === pos
                      ? "border-ink bg-ink text-white"
                      : "border-line-soft bg-surface text-ink-muted hover:bg-canvas-deep hover:text-ink",
                  )}
                >
                  {pos === "bottom-left" ? "Unten links" : "Unten rechts"}
                  {pipPosition === pos && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Form
              </span>
              {PIP_SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onPipShapeChange(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-squircle-sm border px-3 py-2 text-xs font-semibold transition-colors",
                    pipShape === opt.value
                      ? "border-ink bg-ink text-white"
                      : "border-line-soft bg-surface text-ink-muted hover:bg-canvas-deep hover:text-ink",
                  )}
                >
                  {opt.label}
                  {pipShape === opt.value && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
          </aside>
        )}
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

const PROMPTER_LINE_HEIGHT = 1.5;
/** Grenzen für die einstellbare Zeilenanzahl im Prompter-Fenster. */
const PROMPTER_MIN_LINES = 2;
const PROMPTER_MAX_LINES = 8;

/** Gespeicherte Prompter-Einstellung lesen (localStorage, mit Grenzen). */
function readPrompterSetting(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch {
    return fallback;
  }
}

function storePrompterSetting(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage gesperrt → Einstellung gilt nur für diese Session.
  }
}

/**
 * Teleprompter v4 — Fokus-Prompter mit voller manueller Kontrolle:
 *
 *   • Sichtbarkeit steuert der Parent (Toggle oben rechts, default AUS).
 *   • Auto-Scroll rAF-basiert, Tempo in Stufen 1–5 (px/s skaliert mit der
 *     Schriftgröße). Pfeiltasten ←/→ ändern das Tempo jederzeit.
 *   • Manuell scrollen: Mausrad/Trackpad direkt auf dem Text sowie
 *     Pfeiltasten ↑/↓ (eine Zeile zurück/vor) — auch während des
 *     Auto-Scrolls, zum Vor-/Zurückspringen.
 *   • Größe: Schriftgröße (A −/+) und sichtbare Zeilenanzahl (2–8) sind
 *     einstellbar und werden gemerkt.
 *   • Fokus-Band: Die aktuelle Zeile steht zwischen zwei Pfeil-Markern in
 *     der Mitte, Text darüber/darunter ist stark abgedunkelt — so bleibt
 *     das Auge auch bei langen Sätzen auf einer Zeile.
 *   • Overlay-Modus (User-Wahl, gemerkt): Prompter schwebt halbtransparent
 *     ÜBER der Bühne statt darüber anzudocken. Mausrad und Klicks gehen
 *     durch den Text hindurch auf die Bühne — Szenen-Scrollen bleibt frei,
 *     nur die kleine Steuerleiste ist bedienbar.
 *   • Tempo + Schriftgröße werden gemerkt (localStorage).
 */
function Teleprompter({
  script,
  stage,
  overlay,
  onToggleOverlay,
  onScriptChange,
  onHide,
  onHeightChange,
}: {
  script: string;
  stage: "standby" | "countdown" | "live";
  /** true = schwebt über der Bühne (klick-durchlässig). */
  overlay: boolean;
  onToggleOverlay: () => void;
  onScriptChange: (script: string) => void;
  /** Blendet den Prompter aus (gleicher Effekt wie der Toggle im Kopf). */
  onHide: () => void;
  /** Meldet die Balken-Höhe (px) — nur im angedockten Modus relevant. */
  onHeightChange?: (px: number) => void;
}) {
  const [playing, setPlaying] = React.useState(false);
  const [speedLevel, setSpeedLevel] = React.useState(() =>
    readPrompterSetting("vc-prompter-speed", 3, 1, 5),
  );
  const [fontSize, setFontSize] = React.useState(() =>
    readPrompterSetting("vc-prompter-font", 22, 16, 40),
  );
  const [visibleLines, setVisibleLines] = React.useState(() =>
    readPrompterSetting(
      "vc-prompter-lines",
      4,
      PROMPTER_MIN_LINES,
      PROMPTER_MAX_LINES,
    ),
  );
  /** Ohne Text direkt im Bearbeiten-Modus starten. */
  const [editing, setEditing] = React.useState(script.trim().length === 0);

  const changeSpeed = React.useCallback((delta: number) => {
    setSpeedLevel((s) => {
      const next = Math.min(5, Math.max(1, s + delta));
      storePrompterSetting("vc-prompter-speed", next);
      return next;
    });
  }, []);
  const changeFont = React.useCallback((delta: number) => {
    setFontSize((s) => {
      const next = Math.min(40, Math.max(16, s + delta));
      storePrompterSetting("vc-prompter-font", next);
      return next;
    });
  }, []);
  const changeLines = React.useCallback((delta: number) => {
    setVisibleLines((s) => {
      const next = Math.min(
        PROMPTER_MAX_LINES,
        Math.max(PROMPTER_MIN_LINES, s + delta),
      );
      storePrompterSetting("vc-prompter-lines", next);
      return next;
    });
  }, []);

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

  const applyOffset = React.useCallback((px: number) => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;
    const max = Math.max(0, content.scrollHeight - viewport.clientHeight);
    offsetRef.current = Math.min(max, Math.max(0, px));
    content.style.transform = `translateY(${-offsetRef.current}px)`;
  }, []);

  const resetScroll = React.useCallback(() => {
    offsetRef.current = 0;
    if (contentRef.current) {
      contentRef.current.style.transform = "translateY(0px)";
    }
  }, []);

  // Aufnahme läuft → Bearbeiten schließen, von vorn und automatisch scrollen.
  React.useEffect(() => {
    if (stage === "live") {
      setEditing(false);
      resetScroll();
      setPlaying(true);
    }
  }, [stage, resetScroll]);

  React.useEffect(() => {
    if (editing || !playing) return;
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
  }, [editing, playing]);

  // ── Manuell scrollen (Mausrad/Trackpad, non-passive) ─────────────────
  // Im Overlay-Modus ist der Text klick-durchlässig — dort scrollt das Rad
  // bewusst die Bühne, nicht den Prompter.
  React.useEffect(() => {
    if (editing || overlay) return;
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const deltaPx = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      applyOffset(offsetRef.current + deltaPx);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editing, overlay, applyOffset]);

  // ── Pfeiltasten: ←/→ Tempo, ↑/↓ eine Zeile zurück/vor ────────────────
  React.useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        changeSpeed(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        changeSpeed(-1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const linePx = fontRef.current * PROMPTER_LINE_HEIGHT;
        applyOffset(
          offsetRef.current + (e.key === "ArrowDown" ? linePx : -linePx),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, changeSpeed, applyOffset]);

  const lineHeightPx = fontSize * PROMPTER_LINE_HEIGHT;
  // +0,2 Zeilen als An-Schnitt oben/unten — signalisiert „hier geht's weiter".
  const viewportHeight = Math.round(lineHeightPx * (visibleLines + 0.2));
  /** Oberkante der Fokus-Zeile: mittig im Fenster. */
  const focusTopPx = Math.round(viewportHeight / 2 - lineHeightPx / 2);

  // Höhe an den Parent melden (Balken + pb-1) — nur angedockt relevant.
  React.useEffect(() => {
    if (!overlay) onHeightChange?.(viewportHeight + 4);
  }, [viewportHeight, overlay, onHeightChange]);

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

  // Fokus-Band: nur die Zeile in der Mitte ist voll sichtbar, der Rest
  // stark abgedunkelt — das Auge bleibt auf einer Zeile. Die Stops richten
  // sich nach der Zeilenhöhe, damit das Band bei jeder Zeilenanzahl exakt
  // eine Zeile hoch bleibt.
  const halfLinePct = (lineHeightPx / viewportHeight) * 50;
  const focusMask = `linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.25) ${(50 - halfLinePct * 2.2).toFixed(1)}%, rgba(0,0,0,0.35) ${(50 - halfLinePct * 1.3).toFixed(1)}%, black ${(50 - halfLinePct).toFixed(1)}%, black ${(50 + halfLinePct).toFixed(1)}%, rgba(0,0,0,0.35) ${(50 + halfLinePct * 1.3).toFixed(1)}%, rgba(0,0,0,0.25) ${(50 + halfLinePct * 2.2).toFixed(1)}%, transparent 100%)`;

  const controlBtn =
    "rounded-full p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white";
  const controlDivider = <span className="mx-0.5 h-3 w-px bg-white/20" />;

  return (
    <div
      className={cn(
        overlay
          ? "pointer-events-none absolute inset-x-0 top-2 z-[35] mx-auto w-[74%] max-w-3xl"
          : "mx-auto w-full max-w-3xl shrink-0 px-5 pb-1",
      )}
    >
      {/* Prompter-Balken: dunkel, halbtransparent, Fokus-Band in der Mitte */}
      <div
        className={cn(
          "relative overflow-hidden rounded-squircle-lg shadow-lift",
          overlay ? "bg-ink/60" : "bg-ink/85 backdrop-blur",
        )}
      >
        {editing ? (
          <textarea
            autoFocus
            value={script}
            onChange={(e) => onScriptChange(e.target.value)}
            placeholder="Hallo, ich habe mir eure Website angeschaut und…"
            className={cn(
              "block w-full resize-none bg-transparent px-8 text-center font-medium text-white outline-none placeholder:text-white/40",
              overlay && "pointer-events-auto",
            )}
            style={{
              height: viewportHeight,
              fontSize,
              lineHeight: PROMPTER_LINE_HEIGHT,
              paddingTop: Math.round(lineHeightPx * 0.6),
              paddingBottom: Math.round(lineHeightPx * 0.6),
            }}
          />
        ) : (
          <>
            <div
              ref={viewportRef}
              className="overflow-hidden px-10"
              style={{
                height: viewportHeight,
                maskImage: focusMask,
                WebkitMaskImage: focusMask,
              }}
            >
              <div
                ref={contentRef}
                className="mx-auto max-w-xl whitespace-pre-wrap text-center font-medium text-white will-change-transform"
                style={{
                  fontSize,
                  lineHeight: PROMPTER_LINE_HEIGHT,
                  // Erste Zeile startet exakt im Fokus-Band; unten genug
                  // Auslauf, damit auch die letzte Zeile dorthin scrollt.
                  paddingTop: focusTopPx,
                  paddingBottom: Math.round(viewportHeight - focusTopPx),
                }}
              >
                {script}
              </div>
            </div>

            {/* Fokus-Marker links + rechts auf Höhe der aktuellen Zeile */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 text-brand"
              style={{ top: focusTopPx + lineHeightPx / 2 - 8 }}
            >
              <ChevronRight className="size-4" />
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 text-brand"
              style={{ top: focusTopPx + lineHeightPx / 2 - 8 }}
            >
              <ChevronLeft className="size-4" />
            </span>
          </>
        )}

        {/* Kompakte Steuerung im Balken oben rechts */}
        <div
          className={cn(
            "absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-full bg-black/40 px-1.5 py-1 backdrop-blur-sm",
            overlay && "pointer-events-auto",
          )}
        >
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Check className="size-3" />
              Fertig
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label={
                  playing ? "Scrollen pausieren" : "Scrollen starten"
                }
                onClick={togglePlay}
                className={controlBtn}
              >
                {playing ? (
                  <Pause className="size-3 fill-current" />
                ) : (
                  <Play className="size-3 translate-x-px fill-current" />
                )}
              </button>
              {controlDivider}
              <button
                type="button"
                aria-label="Langsamer (Pfeiltaste ←)"
                title="Tempo — auch mit Pfeiltasten ←/→"
                onClick={() => changeSpeed(-1)}
                className={controlBtn}
              >
                <Minus className="size-3" />
              </button>
              <span
                title="Tempo — auch mit Pfeiltasten ←/→"
                className="w-3 text-center text-[9px] font-semibold tabular-nums text-white/70"
              >
                {speedLevel}
              </span>
              <button
                type="button"
                aria-label="Schneller (Pfeiltaste →)"
                title="Tempo — auch mit Pfeiltasten ←/→"
                onClick={() => changeSpeed(1)}
                className={controlBtn}
              >
                <Plus className="size-3" />
              </button>
              {controlDivider}
              <button
                type="button"
                aria-label="Schrift kleiner"
                title="Schriftgröße"
                onClick={() => changeFont(-2)}
                className={controlBtn}
              >
                <Minus className="size-3" />
              </button>
              <span
                title="Schriftgröße"
                className="text-[9px] font-bold text-white/70"
              >
                A
              </span>
              <button
                type="button"
                aria-label="Schrift größer"
                title="Schriftgröße"
                onClick={() => changeFont(2)}
                className={controlBtn}
              >
                <Plus className="size-3" />
              </button>
              {controlDivider}
              <button
                type="button"
                aria-label="Weniger Zeilen anzeigen"
                title="Sichtbare Zeilen"
                onClick={() => changeLines(-1)}
                className={controlBtn}
              >
                <Minus className="size-3" />
              </button>
              <span
                title="Sichtbare Zeilen"
                className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums text-white/70"
              >
                <Rows3 className="size-3" />
                {visibleLines}
              </span>
              <button
                type="button"
                aria-label="Mehr Zeilen anzeigen"
                title="Sichtbare Zeilen"
                onClick={() => changeLines(1)}
                className={controlBtn}
              >
                <Plus className="size-3" />
              </button>
              {controlDivider}
              <button
                type="button"
                aria-label={
                  overlay
                    ? "Prompter über der Bühne andocken"
                    : "Prompter über die Bühne legen"
                }
                title={
                  overlay
                    ? "Andocken: Prompter sitzt wieder über der Bühne"
                    : "Overlay: Prompter schwebt über der Bühne (Scrollen geht durch)"
                }
                onClick={onToggleOverlay}
                className={cn(controlBtn, overlay && "text-brand")}
              >
                <PictureInPicture2 className="size-3" />
              </button>
              {stage === "standby" && (
                <>
                  {controlDivider}
                  <button
                    type="button"
                    aria-label="Text bearbeiten"
                    title="Text bearbeiten"
                    onClick={() => {
                      setPlaying(false);
                      setEditing(true);
                    }}
                    className={controlBtn}
                  >
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
            </>
          )}
          {controlDivider}
          <button
            type="button"
            aria-label="Teleprompter ausblenden"
            title="Ausblenden"
            onClick={onHide}
            className={controlBtn}
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
