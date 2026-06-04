"use client";

/**
 * Spezifische Error-Boundary für /aktivitaet.
 *
 * Konkretere Botschaft als die globale (app)-Boundary, weil der
 * Aktivitäts-Feed mit Live-SSE + Date-Filtering die häufigste Quelle für
 * transiente Client-Crashes ist (siehe Commit 3e6b623). Bietet sowohl
 * Soft-Reset (Next.js segment reset) als auch Hard-Reload an, plus einen
 * Fallback-Link zur Analytics-Übersicht damit der User nicht in einer
 * Sackgasse landet.
 */

import * as React from "react";
import Link from "next/link";
import { Activity, RotateCcw, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AktivitaetError({ error, reset }: ErrorProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[error-boundary] /aktivitaet-Crash:", error, {
      digest: error?.digest,
      message: error?.message,
      stack: error?.stack,
    });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-squircle-md bg-brand-soft text-brand-deep mb-6">
          <Activity className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-ink mb-2">
          Aktivitätsfeed konnte nicht geladen werden
        </h1>
        <p className="text-sm text-ink-muted leading-relaxed mb-2">
          Beim Aufbau der Live-Aktivität ist ein Fehler aufgetreten. Das ist
          fast immer transient — bitte versuchen Sie es noch einmal.
        </p>
        {error?.digest && (
          <p className="text-[11px] font-mono text-ink-muted mb-6">
            Fehler-ID: {error.digest}
          </p>
        )}
        {!error?.digest && <div className="mb-6" />}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="brand"
            iconLeft={<RotateCcw className="size-4" />}
            onClick={() => {
              try {
                reset();
              } catch {
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }
            }}
          >
            Erneut versuchen
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            }}
          >
            Seite neu laden
          </Button>
          <Button
            variant="ghost"
            iconLeft={<BarChart3 className="size-4" />}
            asChild
          >
            <Link href="/analytics">Zur Übersicht</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
