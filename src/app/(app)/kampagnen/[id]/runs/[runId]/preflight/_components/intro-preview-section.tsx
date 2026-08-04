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
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

export interface IntroPreviewInfo {
  enabled: boolean;
  voiceReady: boolean;
  previewApprovedAt: string | null;
  previews: Array<{
    leadId: string;
    firstName: string | null;
    videoUrl: string;
  }>;
}

export function IntroPreviewSection({
  intro,
  checked,
  onCheckedChange,
}: {
  intro: IntroPreviewInfo;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
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

  // Previews werden noch generiert.
  if (intro.previews.length === 0) {
    if (alreadyApproved) return null;
    return (
      <div className="bg-surface rounded-squircle-md shadow-card p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink inline-flex items-center gap-2">
              Beispielvideos werden erstellt
              <Badge variant="brand">
                <Sparkles className="size-3" />
                KI
              </Badge>
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              Wir rendern die personalisierte Begrüßung für die ersten Leads.
              Das dauert wenige Minuten.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-squircle-md shadow-card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <h2 className="text-base font-semibold text-ink">
          Beispielvideos prüfen
        </h2>
        <Badge variant="brand">
          <Sparkles className="size-3" />
          KI
        </Badge>
      </div>
      <p className="text-sm text-ink-muted leading-relaxed">
        So klingt deine personalisierte Begrüßung. Prüfe die Beispiele, bevor
        die gesamte Produktion startet.
      </p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {intro.previews.slice(0, 3).map((p) => (
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
