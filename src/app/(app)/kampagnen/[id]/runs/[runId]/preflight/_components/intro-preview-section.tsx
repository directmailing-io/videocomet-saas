"use client";

/**
 * Preflight-Abschnitt "Beispielvideos prüfen" (personalisierte Video-
 * Begrüßung). Drei Zustände:
 *
 *   1. Voice-Profil fehlt → neutraler Chip: Intro fällt automatisch aus,
 *      Original-Video mit 1 Credit.
 *   2. Previews werden noch generiert → Prozess-Animation mit echten
 *      Pipeline-Schritten + Zeitschätzung (Status-Polling läuft im Parent).
 *   3. Previews vorhanden → bis zu 3 Player + Pflicht-Checkbox, ohne die
 *      die Freigabe der Vollproduktion blockiert ist.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  AudioLines,
  Check,
  Ear,
  Mic,
  ScanFace,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { calibrationErrorHint } from "@/lib/intro-calibration-hints";
import { cn } from "@/lib/utils";
import { aspectClassFor, orientationFromDims, type VideoOrientation } from "@/lib/media/orientation";

export interface IntroPreviewInfo {
  enabled: boolean;
  voiceReady: boolean;
  previewApprovedAt: string | null;
  /** `true` sobald der Worker die Beispielvideo-Generierung abgeschlossen
   *  hat — auch wenn dabei nichts glückte (dann previews leer). */
  previewsGenerated: boolean;
  /** Ziel-Anzahl (drei), für „X von N fertig"-Anzeige. */
  previewsExpected: number;
  /** Kalibrierungs-Zustand vom Server — für konkrete Fehler-Hints. */
  calibrationStatus?: "pending" | "running" | "ready" | "failed" | null;
  calibrationError?: string | null;
  previews: Array<{
    leadId: string;
    firstName: string | null;
    videoUrl: string;
  }>;
}

/** Konkrete Handlungsanweisung pro Kalibrierungs-Fehler-Code. */
function calibrationHint(error: string | null | undefined): string {
  return (
    calibrationErrorHint(error) ??
    "Die Begrüßung im Webcam-Video war zu kurz oder die Pause danach zu knapp. Du kannst neu aufnehmen oder einfach ohne KI-Begrüßung starten (1 Credit pro Video)."
  );
}

/**
 * Prozess-Anzeige während des Renderings: spiegelt die echten Pipeline-
 * Schritte (TTS-Varianten, ASR-Check, EQ, sync.so-Lipsync, QA) zeitbasiert
 * wider. Der Start-Zeitpunkt liegt in sessionStorage, damit ein Reload den
 * Fortschritt nicht zurücksetzt. Der letzte Schritt bleibt aktiv, bis der
 * Server wirklich fertig meldet.
 */
const RENDER_STEPS: Array<{
  label: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  endSec: number;
}> = [
  { label: "Deine KI-Stimme wird geladen", icon: AudioLines, endSec: 8 },
  {
    label: "Begrüßung wird eingesprochen",
    detail: "Wir nehmen mehrere Varianten auf und wählen die natürlichste.",
    icon: Mic,
    endSec: 35,
  },
  {
    label: "Aussprache wird geprüft",
    detail: "Eine zweite KI hört gegen: Klingt der Name richtig?",
    icon: Ear,
    endSec: 55,
  },
  {
    label: "Klang wird an dein Video angepasst",
    detail: "Lautstärke und Raumklang, damit man keinen Übergang hört.",
    icon: SlidersHorizontal,
    endSec: 70,
  },
  {
    label: "Lippenbewegungen werden synchronisiert",
    detail: "Der aufwendigste Schritt: dein Mund bewegt sich passend zum neuen Ton.",
    icon: ScanFace,
    endSec: 150,
  },
  {
    label: "Feinschliff und Qualitäts-Check",
    detail: "Jedes Video wird nochmal automatisch gegengehört.",
    icon: Wand2,
    endSec: Number.POSITIVE_INFINITY,
  },
];
// W2-Speedup (Teil-Assembly, 720p, schnelleres Polling): Previews brauchen
// jetzt typischerweise ~1,5-2,5 min statt ~5 — Schätzung entsprechend.
const TOTAL_EST_SEC = 170;

function useRenderElapsed(storageKey: string): number {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    let startedAt = Number(window.sessionStorage.getItem(storageKey));
    if (!startedAt || Number.isNaN(startedAt)) {
      startedAt = Date.now();
      window.sessionStorage.setItem(storageKey, String(startedAt));
    }
    const tick = () =>
      setElapsed(Math.max(0, (Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [storageKey]);
  return elapsed;
}

function RenderingProgress({
  storageKey,
  readyCount,
  expected,
}: {
  storageKey: string;
  readyCount: number;
  expected: number;
}) {
  const elapsedSec = useRenderElapsed(storageKey);
  let activeIdx = RENDER_STEPS.findIndex((s) => elapsedSec < s.endSec);
  if (activeIdx === -1) activeIdx = RENDER_STEPS.length - 1;

  const timePct = Math.min(94, (elapsedSec / TOTAL_EST_SEC) * 100);
  const donePct = (readyCount / expected) * 100;
  const pct = Math.round(Math.max(timePct, Math.min(donePct, 94)));

  const remainSec = TOTAL_EST_SEC - elapsedSec;
  const remainLabel =
    remainSec <= 0
      ? "Gleich fertig, dauert heute einen Moment länger ..."
      : remainSec < 75
        ? "Noch ungefähr eine Minute"
        : `Noch ungefähr ${Math.ceil(remainSec / 60)} Minuten`;

  return (
    <div className="mt-4 rounded-squircle-sm bg-gradient-to-br from-brand-soft/70 via-surface-soft to-surface-soft border border-brand/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <span className="text-xs font-semibold text-ink">
          {readyCount > 0
            ? `${readyCount} von ${expected} Videos fertig`
            : "Deine Beispielvideos entstehen gerade"}
        </span>
        <span className="text-xs text-ink-muted tabular-nums">
          {remainLabel}
        </span>
      </div>

      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-deep transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>

      <ol className="flex flex-col gap-2.5">
        {RENDER_STEPS.map((step, idx) => {
          const state =
            idx < activeIdx ? "done" : idx === activeIdx ? "active" : "todo";
          const Icon = step.icon;
          return (
            <li key={step.label} className="flex items-start gap-3">
              <span
                className={cn(
                  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full",
                  state === "done" && "bg-ok/15 text-ok",
                  state === "active" && "bg-brand text-white shadow-brand",
                  state === "todo" && "bg-white/60 text-ink-muted/50",
                )}
              >
                {state === "active" && (
                  <span className="absolute inset-0 rounded-full bg-brand/40 animate-ping" />
                )}
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Icon className="relative size-3.5" />
                )}
              </span>
              <span className="min-w-0 pt-0.5">
                <span
                  className={cn(
                    "block text-sm leading-snug",
                    state === "active" && "font-semibold text-ink",
                    state === "done" && "font-medium text-ink-muted",
                    state === "todo" && "text-ink-muted/60",
                  )}
                >
                  {step.label}
                  {state === "active" && " ..."}
                </span>
                {state === "active" && step.detail && (
                  <span className="mt-0.5 block text-xs text-ink-muted leading-relaxed">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function IntroPreviewSection({
  intro,
  checked,
  onCheckedChange,
  campaignId,
  runId,
}: {
  intro: IntroPreviewInfo;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Für den Direkt-Link zur Bearbeiten-Seite mit Webcam-Karte. */
  campaignId: string;
  /** Für die Fortschritts-Persistenz über Reloads (sessionStorage-Key). */
  runId: string;
}) {
  /** Format je Vorschau-Video aus den echten Videomaßen (Hochkant-Webcam → Hochkant-Vorschau). Vor dem Early-Return (Rules of Hooks). */
  const [previewOrientation, setPreviewOrientation] = React.useState<Record<string, VideoOrientation>>({});
  if (!intro.enabled) return null;

  // Kein ready-Voice-Profil → Feature fällt für diese Runde aus.
  if (!intro.voiceReady) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-squircle-sm bg-surface border border-line-soft shadow-card">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-squircle-sm bg-surface-soft text-ink-muted">
          <Sparkles className="size-4" />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">
            Diesmal ohne KI-Begrüßung
          </p>
          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
            Deine KI-Stimme ist für diese Runde noch nicht bereit. Kein
            Problem: Die Videos starten ganz normal und kosten nur 1 Credit
            pro Video.
          </p>
        </div>
      </div>
    );
  }

  const alreadyApproved = intro.previewApprovedAt !== null;
  const done = intro.previewsGenerated;
  const expected = Math.max(1, intro.previewsExpected);
  const readyCount = intro.previews.length;
  const rendering = !done;

  // Endzustand: fertig UND null Erfolge — Kalibrierung/Voice/Rendering
  // ist schiefgelaufen. Endloser Spinner wäre irreführend.
  if (done && readyCount === 0) {
    if (alreadyApproved) return null;
    return (
      <div className="bg-surface rounded-squircle-md shadow-card p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-warn-soft text-warn">
            <AlertTriangle className="size-4" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">
              Beispielvideos konnten nicht erstellt werden
            </p>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              {intro.calibrationStatus === "failed"
                ? calibrationHint(intro.calibrationError)
                : "Beim Vorbereiten deines Webcam-Videos ist etwas schiefgelaufen. Du kannst neu aufnehmen oder einfach ohne KI-Begrüßung starten (1 Credit pro Video)."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/kampagnen/${campaignId}/bearbeiten`}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep transition-colors"
              >
                Webcam-Video neu aufnehmen
              </Link>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-medium text-ink-muted">
                Oder klick oben auf „Videos jetzt erstellen", dann läuft es
                ohne KI-Begrüßung
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-squircle-md shadow-card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <h2 className="text-base font-semibold text-ink">
          {rendering ? "Beispielvideos werden erstellt" : "Beispielvideos prüfen"}
        </h2>
        <Badge variant="brand">
          <Sparkles className="size-3" />
          KI
        </Badge>
      </div>
      <p className="text-sm text-ink-muted leading-relaxed">
        {rendering
          ? `Wir erstellen gerade ${expected} Beispielvideos mit deiner KI-Begrüßung. Das dauert insgesamt etwa 5 Minuten, die fertigen Videos tauchen hier automatisch auf.`
          : "So klingt deine persönliche Begrüßung. Schau dir die Beispiele an, bevor alle Videos erstellt werden."}
      </p>

      {rendering && (
        <RenderingProgress
          storageKey={`vc-intro-progress-${runId}`}
          readyCount={readyCount}
          expected={expected}
        />
      )}

      {readyCount > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {intro.previews.slice(0, expected).map((p) => (
            <div key={p.leadId} className="min-w-0">
              <div
                className={cn(
                  "overflow-hidden rounded-squircle-sm bg-ink",
                  aspectClassFor(previewOrientation[p.leadId] ?? null, { portraitMaxWidth: "max-w-[240px]" }),
                )}
              >
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={p.videoUrl}
                  controls
                  controlsList="nodownload"
                  preload="metadata"
                  playsInline
                  className="h-full w-full object-contain"
                  onLoadedMetadata={(e) => {
                    const o = orientationFromDims(e.currentTarget.videoWidth, e.currentTarget.videoHeight);
                    if (o) setPreviewOrientation((m) => (m[p.leadId] === o ? m : { ...m, [p.leadId]: o }));
                  }}
                />
              </div>
              <p className="mt-2 text-sm font-semibold text-ink truncate">
                {p.firstName ?? "Ohne Vornamen"}
              </p>
            </div>
          ))}
        </div>
      )}

      {alreadyApproved ? (
        <p className="mt-4 text-xs text-ok font-medium">
          Beispielvideos wurden bereits freigegeben.
        </p>
      ) : (
        <label className="mt-4 flex items-start gap-3 rounded-squircle-sm bg-surface-soft p-4 cursor-pointer">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
            className="mt-0.5"
            aria-label="Beispielvideos freigeben"
          />
          <span className="text-sm text-ink leading-relaxed">
            Ich habe die Beispielvideos geprüft und gebe diese Qualität für
            die gesamte Produktion frei.
          </span>
        </label>
      )}
    </div>
  );
}
