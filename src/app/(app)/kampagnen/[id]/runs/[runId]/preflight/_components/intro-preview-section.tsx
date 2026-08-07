"use client";

/**
 * Preflight-Abschnitt "Beispielvideos prüfen" (personalisierte Video-
 * Begrüßung). Drei Zustände:
 *
 *   1. Voice-Profil fehlt → neutraler Chip: Intro fällt automatisch aus,
 *      Original-Video mit 1 Credit.
 *   2. Previews werden noch generiert → Spinner-Karte (Status-Polling
 *      läuft im Parent).
 *   3. Previews vorhanden → bis zu 3 Player + Pflicht-Checkbox, ohne die
 *      die Freigabe der Vollproduktion blockiert ist.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

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
  switch (error) {
    case "greeting_too_late":
      return "Deine Anrede beginnt zu spät oder du hast durchgesprochen. Nimm neu auf und starte SOFORT mit einer kurzen Anrede („Hi!“), dann 1 Sekunde Stille, dann der erste Satz.";
    case "no_pause_detected":
      return "Wir haben keine deutliche Pause nach deiner Anrede gefunden. Nimm neu auf: erst „Hi!“ sagen, dann 1 Sekunde Stille, dann der erste Satz.";
    case "no_speech_detected":
    case "audio_flat":
      return "Wir konnten keine Sprache am Anfang des Videos erkennen.";
    case "greeting_inaudible":
      return "Deine Anrede am Anfang war zu leise oder nicht erkennbar. Nimm neu auf und sprich die Anrede klar und deutlich.";
    case "no_sentence_after_pause":
      return "Nach der Pause hinter deiner Anrede kommt keine Sprache mehr. Sprich nach der kurzen Pause einen ersten Satz weiter.";
    default:
      return "Die Anrede im Webcam-Video war zu kurz oder die bewusste Pause danach zu knapp. Neu aufnehmen oder mit Original-Video (1 Credit pro Lead) starten — deine Wahl.";
  }
}

export function IntroPreviewSection({
  intro,
  checked,
  onCheckedChange,
  campaignId,
}: {
  intro: IntroPreviewInfo;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Für den Direkt-Link zur Bearbeiten-Seite mit Webcam-Karte. */
  campaignId: string;
}) {
  if (!intro.enabled) return null;

  // Kein ready-Voice-Profil → Feature fällt für diese Runde aus.
  if (!intro.voiceReady) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="neutral">
          Ohne personalisierte Begrüßung, 1 Credit pro Video
        </Badge>
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
                : "Die Kalibrierung deines Webcam-Videos ist noch nicht bereit oder das Rendering ist fehlgeschlagen. Neu aufnehmen oder mit Original-Video (1 Credit pro Lead) starten — deine Wahl."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/kampagnen/${campaignId}/bearbeiten`}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep transition-colors"
              >
                Zur Kampagne — Webcam neu aufnehmen
              </Link>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-medium text-ink-muted">
                Alternativ: oben „Vollproduktion starten" — läuft dann ohne
                KI-Begrüßung
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sichtbare Slots: bereits fertige Videos + Skeleton für die noch
  // laufenden (Progress-Feedback: „X von N").
  const skeletonCount = rendering ? Math.max(0, expected - readyCount) : 0;
  const progressPercent = Math.round((readyCount / expected) * 100);

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
          ? `${readyCount} von ${expected} fertig — die Videos erscheinen einzeln, sobald sie gerendert sind. Das dauert ein bis zwei Minuten.`
          : "So klingt deine personalisierte Begrüßung. Prüfe die Beispiele, bevor die gesamte Produktion startet."}
      </p>

      {rendering && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-soft">
          <div
            className="h-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
            aria-hidden
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {intro.previews.slice(0, expected).map((p) => (
          <div key={p.leadId} className="min-w-0">
            <div className="overflow-hidden rounded-squircle-sm bg-ink aspect-video">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={p.videoUrl}
                controls
                controlsList="nodownload"
                preload="metadata"
                playsInline
                className="h-full w-full object-contain"
              />
            </div>
            <p className="mt-2 text-sm font-semibold text-ink truncate">
              {p.firstName ?? "Ohne Vornamen"}
            </p>
          </div>
        ))}
        {Array.from({ length: skeletonCount }).map((_, idx) => (
          <div key={`skeleton-${idx}`} className="min-w-0">
            <div className="relative overflow-hidden rounded-squircle-sm bg-surface-muted aspect-video">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="inline-block size-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-surface-muted via-line-soft to-surface-muted opacity-40 animate-pulse" />
            </div>
            <p className="mt-2 text-xs text-ink-muted">Wird gerendert ...</p>
          </div>
        ))}
      </div>

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
