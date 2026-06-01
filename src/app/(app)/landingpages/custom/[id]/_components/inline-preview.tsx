"use client";

/**
 * Live-Vorschau einer Custom-LP-Version, mit allen Assets inline (Data-URLs).
 *
 * Holt vom Server `/api/custom-lp/[id]/versions/[vid]/preview` ein
 * komplett zusammengebautes HTML mit Demo-Lead-Daten und zeigt das im
 * srcDoc-Iframe. Dadurch sieht der User EXAKT, wie ein Kunde die Seite
 * sieht — inklusive Styling, Fonts, Bilder, JS.
 */

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, RefreshCw, AlertCircle, Maximize2 } from "lucide-react";

interface InlinePreviewProps {
  templateId: string;
  versionId: string;
  /** Zeigt einen Hinweis, dass diese Version (noch) nicht aktiv ist. */
  isActive?: boolean;
}

interface PreviewState {
  kind: "idle" | "loading" | "ready" | "error";
  html?: string;
  error?: string;
  fileCount?: number;
  byteCount?: number;
}

export function InlinePreview({
  templateId,
  versionId,
  isActive = true,
}: InlinePreviewProps) {
  const [state, setState] = React.useState<PreviewState>({ kind: "idle" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/custom-lp/${templateId}/versions/${versionId}/preview`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setState({
          kind: "error",
          error: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as {
        html: string;
        fileCount: number;
        byteCount: number;
      };
      setState({
        kind: "ready",
        html: body.html,
        fileCount: body.fileCount,
        byteCount: body.byteCount,
      });
    } catch (err) {
      setState({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [templateId, versionId]);

  // Auto-load on mount + on version change
  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardContent className="p-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5 bg-surface-muted/50">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="size-4 text-brand-deep shrink-0" />
            <h3 className="text-sm font-semibold text-ink truncate">
              Live-Vorschau
            </h3>
            <span className="text-[11px] text-ink-muted ml-1 hidden sm:inline">
              mit Demo-Lead Peter Müller
            </span>
            {!isActive && (
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full ml-1">
                inaktive Version
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {state.kind === "ready" && (
              <span className="text-[11px] text-ink-muted hidden md:inline">
                {state.fileCount} Dateien · {Math.round((state.byteCount ?? 0) / 1024)} KB
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void load()}
              iconLeft={<RefreshCw className="size-3.5" />}
              disabled={state.kind === "loading"}
            >
              Neu laden
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={state.kind !== "ready" || !state.html}
              onClick={() => {
                if (!state.html) return;
                const w = window.open("", "_blank");
                if (!w) return;
                w.document.open();
                w.document.write(state.html);
                w.document.close();
              }}
              iconLeft={<Maximize2 className="size-3.5" />}
            >
              In neuem Tab
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="relative bg-canvas">
          {state.kind === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 className="size-4 animate-spin" />
                Vorschau wird generiert …
              </div>
            </div>
          )}
          {state.kind === "error" && (
            <div className="px-5 py-8 flex items-start gap-3">
              <AlertCircle className="size-5 text-danger shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-ink">
                  Vorschau konnte nicht generiert werden
                </p>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  {state.error}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3"
                  onClick={() => void load()}
                >
                  Erneut versuchen
                </Button>
              </div>
            </div>
          )}
          {state.kind === "ready" && state.html && (
            <iframe
              key={versionId}
              title="Live-Vorschau der Landingpage"
              srcDoc={state.html}
              sandbox="allow-scripts allow-same-origin"
              className="block w-full bg-white"
              style={{ height: "720px", border: "none" }}
            />
          )}
          {state.kind === "idle" && (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              Vorschau wird vorbereitet …
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
