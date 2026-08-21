"use client";

/**
 * Sofort-Feedback direkt nach einer Webcam-Aufnahme: Der Upload stößt die
 * Begrüßungs-Analyse automatisch an (POST /api/media), diese Komponente
 * pollt den Status und sagt dem User SOFORT, ob sein Video-Anfang für die
 * KI-Begrüßung passt — statt dass er es erst beim Kampagnen-Start (oder
 * nie) erfährt.
 *
 * Bewusst nicht blockierend: Die KI-Begrüßung ist optional. Bei einem
 * Analyse-Fehler zeigen wir Hinweis + Transkript-Zitat, der User kann
 * trotzdem weitermachen.
 */

import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { calibrationErrorHint } from "@/lib/intro-calibration-hints";
import { cn } from "@/lib/utils";

interface CalibrationDto {
  status: "pending" | "running" | "ready" | "failed";
  transcriptSentence: string | null;
  error: string | null;
}

const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 Minuten, danach stiller Abbruch

export function IntroAnalysisStatus({
  mediaId,
  className,
}: {
  mediaId: string;
  className?: string;
}) {
  const [calibration, setCalibration] = React.useState<
    CalibrationDto | null | "unavailable"
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;

    async function poll() {
      polls++;
      try {
        const res = await fetch(`/api/media/${mediaId}/intro-calibration`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as {
          calibration: CalibrationDto | null;
        };
        if (cancelled) return;
        if (!data.calibration) {
          setCalibration("unavailable");
          return;
        }
        setCalibration(data.calibration);
        const running =
          data.calibration.status === "pending" ||
          data.calibration.status === "running";
        if (running && polls < MAX_POLLS) {
          timer = window.setTimeout(() => void poll(), POLL_MS);
        }
      } catch {
        if (!cancelled) setCalibration("unavailable");
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [mediaId]);

  if (calibration === null || calibration === "unavailable") return null;

  if (calibration.status === "pending" || calibration.status === "running") {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-squircle-md bg-surface-soft px-3 py-2.5 text-xs text-ink-muted",
          className,
        )}
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-deep" />
        Wir prüfen gerade den Anfang deines Videos für die KI-Begrüßung …
      </div>
    );
  }

  if (calibration.status === "ready") {
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-squircle-md bg-ok/10 px-3 py-2.5 text-xs leading-relaxed text-ink",
          className,
        )}
      >
        <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
        <span>
          <b>Perfekt für die KI-Begrüßung:</b> Begrüßung und Pause erkannt.
          {calibration.transcriptSentence && (
            <>
              {" "}
              Dein erster Satz:{" "}
              <span className="italic">
                &bdquo;{calibration.transcriptSentence}&ldquo;
              </span>
            </>
          )}
        </span>
      </div>
    );
  }

  // failed — Hinweis, aber nicht blockierend (Feature ist optional).
  const hint =
    calibrationErrorHint(calibration.error) ??
    "Der Anfang deines Videos passt noch nicht für die KI-Begrüßung.";
  return (
    <div
      className={cn(
        "space-y-1 rounded-squircle-md bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-ink",
        className,
      )}
    >
      <p className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
        <span>
          <b>Nur wichtig, wenn du die KI-Begrüßung nutzen willst:</b> {hint}
        </span>
      </p>
      {calibration.transcriptSentence && (
        <p className="pl-6 text-ink-muted">
          Gehört haben wir:{" "}
          <span className="italic">
            &bdquo;{calibration.transcriptSentence}&ldquo;
          </span>
        </p>
      )}
      <p className="pl-6 text-ink-muted">
        Ohne KI-Begrüßung kannst du ganz normal weitermachen.
      </p>
    </div>
  );
}
