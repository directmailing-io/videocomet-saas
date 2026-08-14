"use client";

/**
 * Studio-Aufnahme (Live-Regie) — Vollbild-Flow mit 4 Phasen:
 * Regie (Szenen-Setup) → Bereit-Check → Live-Aufnahme → Review.
 * Konzept: docs/konzept-studio-modus.md.
 *
 * Dieser Export-Vertrag ist fix — die Wizard-Integration baut dagegen.
 *
 * Der Flow ist Owner von: Szenen (StudioTab[]), Kamera-Stream
 * (use-studio-media, überlebt Phasenwechsel), PiP-Wahl, Teleprompter-Skript
 * (localStorage) und dem Aufnahme-Ergebnis. Vor Phase 3 werden alle
 * Szenen-Bilder vor-decodiert, damit die Live-Aufnahme ohne Netz auskommt.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import type { Segment } from "@/lib/segments/types";
import type { StudioTab } from "@/lib/studio/types";
import { PhaseRegie } from "./phase-regie";
import { PhaseCheck } from "./phase-check";
import { PhaseLive } from "./phase-live";
import { PhaseReview } from "./phase-review";
import { useStudioMedia } from "./use-studio-media";
import { useSceneAssets } from "./use-scene-assets";
import {
  STUDIO_PROMPTER_STORAGE_KEY,
  tabImageUrls,
  type StudioRecording,
  type UpdateSegmentFn,
} from "./internal";

export type StudioPipPosition = "bottom-left" | "bottom-right";
export type StudioPipShape = "square" | "rounded" | "circle";

export interface StudioFlowResult {
  /** media_items.id der hochgeladenen Webcam-Aufnahme (POST /api/media). */
  webcamMediaId: string;
  /** Fertige Standard-Segmente; Σ Dauer == Server-ffprobe-Dauer der Webcam. */
  segments: Segment[];
  pipPosition: StudioPipPosition;
  pipShape: StudioPipShape;
}

export interface StudioFlowProps {
  /** Wird nach „Übernehmen" im Review aufgerufen. */
  onComplete: (result: StudioFlowResult) => void;
  /** Abbruch in jeder Phase (zurück zum klassischen Wizard). */
  onCancel: () => void;
}

type StudioPhase = "regie" | "check" | "live" | "review";

function newTabId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function StudioFlow({ onComplete, onCancel }: StudioFlowProps) {
  const [phase, setPhase] = React.useState<StudioPhase>("regie");
  const [tabs, setTabs] = React.useState<StudioTab[]>([]);
  const [pipPosition, setPipPosition] =
    React.useState<StudioPipPosition>("bottom-right");
  const [pipShape, setPipShape] = React.useState<StudioPipShape>("rounded");
  const [liveMode, setLiveMode] = React.useState<"record" | "practice">(
    "record",
  );
  const [recording, setRecording] = React.useState<StudioRecording | null>(
    null,
  );

  // ── Teleprompter-Skript (geteilt mit dem Webcam-Recorder) ────────────
  const [script, setScript] = React.useState("");
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STUDIO_PROMPTER_STORAGE_KEY);
      if (saved) setScript(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const handleScriptChange = React.useCallback((next: string) => {
    setScript(next);
    try {
      window.localStorage.setItem(STUDIO_PROMPTER_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Szenen-Verwaltung ────────────────────────────────────────────────
  const addTab = React.useCallback((segment: Segment) => {
    setTabs((prev) => [...prev, { id: newTabId(), segment }]);
  }, []);

  const removeTab = React.useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
  }, []);

  const moveTab = React.useCallback((tabId: string, direction: -1 | 1) => {
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === tabId);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const updateSegment: UpdateSegmentFn = React.useCallback(
    (tabId, update) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, segment: update(t.segment) } : t,
        ),
      );
    },
    [],
  );

  // ── Assets + Kamera auf Flow-Ebene ───────────────────────────────────
  const assets = useSceneAssets(tabs, updateSegment);
  const media = useStudioMedia();

  // ── Bild-Preloading vor der Live-Phase (netzfreie Aufnahme) ──────────
  const [preloadReady, setPreloadReady] = React.useState(false);
  const preloadedRef = React.useRef<HTMLImageElement[]>([]);
  React.useEffect(() => {
    if (phase !== "check") return;
    setPreloadReady(false);
    let cancelled = false;
    const urls = Array.from(new Set(tabs.flatMap((t) => tabImageUrls(t))));
    const images = urls.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });
    preloadedRef.current = images;
    void Promise.allSettled(images.map((img) => img.decode())).then(() => {
      if (!cancelled) setPreloadReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, tabs]);

  // ── Phasen-Übergänge ─────────────────────────────────────────────────
  const goCheck = React.useCallback(() => setPhase("check"), []);

  const startLive = React.useCallback((mode: "record" | "practice") => {
    setLiveMode(mode);
    setPhase("live");
  }, []);

  const handleFinished = React.useCallback(
    (rec: StudioRecording) => {
      setRecording(rec);
      // Kamera-LED aus — für Upload/Review wird der Stream nicht gebraucht.
      media.stop();
      setPhase("review");
    },
    [media],
  );

  const handleExitPractice = React.useCallback(() => setPhase("check"), []);

  const handleRetake = React.useCallback(() => {
    setRecording(null);
    setPhase("check");
    // Kamera wurde nach der Aufnahme gestoppt → neu initialisieren.
    void media.init();
  }, [media]);

  const handleCancel = React.useCallback(() => {
    media.stop();
    onCancel();
  }, [media, onCancel]);

  // Als Body-Portal rendern: der Wizard steckt in einem eigenen
  // Stacking-Context, wodurch globale Overlays (Cookie-Banner z-[90],
  // Onboarding-Dialog) sonst ÜBER dem Studio landen und die Bedienung
  // blockieren. z-[120] liegt bewusst über allen App-Overlays.
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(
    null,
  );
  React.useEffect(() => setPortalTarget(document.body), []);
  if (!portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col overflow-hidden"
      style={{ backgroundColor: "#17151f" }}
    >
      {phase === "regie" && (
        <PhaseRegie
          tabs={tabs}
          onAddTab={addTab}
          onRemoveTab={removeTab}
          onMoveTab={moveTab}
          updateSegment={updateSegment}
          assets={assets}
          script={script}
          onScriptChange={handleScriptChange}
          onNext={goCheck}
          onCancel={handleCancel}
        />
      )}

      {phase === "check" && (
        <PhaseCheck
          media={media}
          pipPosition={pipPosition}
          pipShape={pipShape}
          onPipPositionChange={setPipPosition}
          onPipShapeChange={setPipShape}
          preloadReady={preloadReady}
          onStartRecording={() => startLive("record")}
          onStartPractice={() => startLive("practice")}
          onBack={() => setPhase("regie")}
          onCancel={handleCancel}
        />
      )}

      {phase === "live" && (
        <PhaseLive
          tabs={tabs}
          stream={media.stream}
          mode={liveMode}
          pipPosition={pipPosition}
          pipShape={pipShape}
          script={script}
          onFinished={handleFinished}
          onExitPractice={handleExitPractice}
        />
      )}

      {phase === "review" && recording && (
        <PhaseReview
          tabs={tabs}
          recording={recording}
          pipPosition={pipPosition}
          pipShape={pipShape}
          onComplete={onComplete}
          onRetake={handleRetake}
        />
      )}
    </div>,
    portalTarget,
  );
}
