"use client";

/**
 * Globale Error-Boundary für die gesamte App-Shell.
 *
 * Next.js rendert diese Datei automatisch, wenn ein Client-Component-Render
 * im (app)-Segment einen unhandled Error wirft. Statt eines weißen Screens
 * mit der generischen „Application error: a client-side exception has
 * occurred"-Meldung zeigen wir hier einen freundlichen Recovery-Screen.
 *
 * Reset-Strategie:
 *   1. `reset()` versucht das fehlerhafte Segment ohne Full-Reload neu zu
 *      rendern. Reicht oft, wenn der Crash transient war (z.B. ein einzelnes
 *      Sub-State-Update warf einen TypeError).
 *   2. Reload-Fallback: harter `window.location.reload()` für Fälle, in
 *      denen der State der Boundary selbst korrupt ist.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
  React.useEffect(() => {
    // Browser-Console-Log mit konsistentem Prefix — erleichtert das
    // Debuggen über die Dev-Tools. Der `digest` wird vom Server geliefert
    // und matched mit den Vercel/Coolify-Logs.
    // eslint-disable-next-line no-console
    console.error("[error-boundary] App-Shell-Crash:", error, {
      digest: error?.digest,
    });
  }, [error]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-squircle-md bg-brand-soft text-brand-deep mb-6">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="text-2xl font-bold text-ink mb-2">
          Etwas ist schiefgegangen
        </h1>
        <p className="text-sm text-ink-muted leading-relaxed mb-2">
          In der Anwendung ist ein unerwarteter Fehler aufgetreten. Wir haben
          das Problem geloggt — bitte versuchen Sie es erneut.
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
                // Reset selbst geworfen — Full-Reload als Fallback.
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
            iconLeft={<Home className="size-4" />}
            asChild
          >
            <Link href="/dashboard">Zum Dashboard</Link>
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
        </div>
      </div>
    </div>
  );
}
