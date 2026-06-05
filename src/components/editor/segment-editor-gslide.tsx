"use client";

import * as React from "react";
import {
  RotateCw,
  Presentation,
  AlertTriangle,
  ImageOff,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { GSlideSegment } from "@/lib/segments/types";

/**
 * Segment-Editor für eine importierte Google-Slides-Folie.
 *
 * Es gibt bewusst KEINEN Edit-Knopf für `publishedUrl`: wenn der User
 * eine andere Folie/eine andere Präsentation einbinden will, soll er
 * ein neues Segment erstellen — das vermeidet Inkonsistenz zwischen
 * Index und Thumbnail.
 *
 * `Aktualisieren` ruft `POST /api/gslides/refresh` auf, aktualisiert
 * Thumbnail + Platzhalter-Liste im lokalen State und zeigt einen Toast.
 */

export interface SegmentEditorGSlideProps {
  segment: GSlideSegment;
  onChange: (segment: GSlideSegment) => void;
}

interface RefreshResponse {
  thumbnailUrl: string;
  detectedPlaceholders: string[];
}

/**
 * Relative Zeit: „vor 3 Min", „vor 2 Std", „vor 4 Tagen", oder
 * „gerade eben" für < 60s.
 */
function formatRelative(iso: string): string {
  if (!iso) return "noch nie";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "unbekannt";
  const deltaMs = Date.now() - ts;
  const sec = Math.round(deltaMs / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} Std`;
  const days = Math.round(hr / 24);
  if (days < 14) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  const weeks = Math.round(days / 7);
  return `vor ${weeks} ${weeks === 1 ? "Woche" : "Wochen"}`;
}

export function SegmentEditorGSlide({
  segment,
  onChange,
}: SegmentEditorGSlideProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  // Damit „vor X Min" sich nach 30s automatisch aktualisiert, retriggern
  // wir den Re-Render alle 30s. Vermeidet Stale-UI.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 30_000);
    return () => clearInterval(id);
  }, []);

  async function handleRefresh() {
    if (refreshing) return;
    if (!segment.publishedUrl) {
      setRefreshError(
        "Keine Veröffentlichungs-URL hinterlegt — neues Segment erstellen.",
      );
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/gslides/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishedUrl: segment.publishedUrl,
          slideIndex: segment.slideIndex,
        }),
      });
      if (!res.ok) {
        let msg = "Aktualisieren fehlgeschlagen.";
        try {
          const parsed = (await res.json()) as { error?: string };
          if (parsed?.error) {
            if (parsed.error === "not_published") {
              msg = "Die Präsentation ist nicht mehr veröffentlicht.";
            } else {
              msg = parsed.error;
            }
          }
        } catch {
          // body was not json
        }
        setRefreshError(msg);
        toast({
          variant: "danger",
          title: "Aktualisieren fehlgeschlagen",
          description: msg,
        });
        return;
      }
      const data = (await res.json()) as RefreshResponse;
      onChange({
        ...segment,
        thumbnailUrl: data.thumbnailUrl,
        detectedPlaceholders: data.detectedPlaceholders,
        lastFetchedAt: new Date().toISOString(),
      });
      toast({
        variant: "success",
        title: "Folie aktualisiert",
        description: `Folie ${segment.slideIndex + 1} wurde neu geladen.`,
      });
    } catch {
      const msg = "Folie konnte nicht aktualisiert werden.";
      setRefreshError(msg);
      toast({
        variant: "danger",
        title: "Aktualisieren fehlgeschlagen",
        description: msg,
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header: Thumbnail-Preview (16:9, schwarz, contain) */}
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-md border border-line bg-ink">
        {segment.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={segment.thumbnailUrl}
            alt={`Folie ${segment.slideIndex + 1}`}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-muted/80">
            <ImageOff className="size-8" />
            <span className="text-xs">Kein Thumbnail geladen</span>
          </div>
        )}
        {/* Slide-Number Badge */}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-bold text-white">
          <Presentation className="size-3" />
          Folie {segment.slideIndex + 1}
        </span>
      </div>

      {/* Info-Zeile */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-sm border border-line bg-surface-soft px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Folie {segment.slideIndex + 1} aus Präsentation
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Zuletzt synchronisiert: {formatRelative(segment.lastFetchedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          onClick={handleRefresh}
          loading={refreshing}
          iconLeft={!refreshing ? <RotateCw className="size-3.5" /> : undefined}
        >
          Aktualisieren
        </Button>
      </div>

      {/* Platzhalter */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Erkannte Platzhalter
        </p>
        {segment.detectedPlaceholders.length === 0 ? (
          <div className="flex items-start gap-2 rounded-squircle-sm border border-line bg-surface-soft p-3 text-xs text-ink-muted">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            <span className="leading-snug">
              Auf dieser Folie wurden keine{" "}
              <code className="font-mono">{"{{key}}"}</code>-Platzhalter
              gefunden. Sie wird unverändert gerendert.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {segment.detectedPlaceholders.map((key) => (
                <span
                  key={key}
                  className={cn(
                    "inline-flex items-center rounded-full border border-warn/40 bg-warn/5 px-2.5 py-1 font-mono text-[11px] font-medium text-warn-deep",
                  )}
                  title={`Erkannt, aber nicht ersetzbar in Google Slides: {{${key}}}`}
                >
                  {`{{${key}}}`}
                </span>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-squircle-sm border border-warn/30 bg-warn/5 p-3 text-xs text-warn-deep">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span className="leading-snug">
                <strong>Diese Platzhalter werden NICHT pro Lead ersetzt.</strong>{" "}
                Google rendert Folientext server-seitig zu Vektor-Pfaden — der
                Originaltext kann nachträglich nicht mehr substituiert werden.
                Für personalisierte Texte nutze stattdessen den Folientyp
                {" "}<strong>Freie Folie</strong> oder eine{" "}
                <strong>Textfolie</strong>.
              </span>
            </div>
          </>
        )}
      </div>

      {/* Sync-Hinweis */}
      {!refreshError && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-brand-200 bg-brand-soft px-4 py-3 text-sm text-brand-deep">
          <Info className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">
            Hast du die Slides nachträglich bearbeitet? Erst in Google Slides{" "}
            <strong className="font-semibold">veröffentlichen</strong>, dann
            hier auf „Aktualisieren" klicken — sonst zeigen wir die alte
            Version.
          </span>
        </div>
      )}

      {/* Inline-Error */}
      {refreshError && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">{refreshError}</span>
        </div>
      )}
    </div>
  );
}
