"use client";

import * as React from "react";
import {
  RotateCw,
  Wand2,
  AlertTriangle,
  ImageOff,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { CanvaSegment } from "@/lib/segments/types";
import { CanvaImportDialog } from "./canva-import-dialog";

/**
 * Segment-Editor für eine importierte Canva-Folie (PPTX-Pipeline).
 *
 * Spiegelt das Pattern von `segment-editor-gslide.tsx`:
 *   - 16:9 Thumbnail-Vorschau auf schwarzem Hintergrund (object-contain)
 *   - Info-Zeile mit Dateiname + Folien-Nummer + "Zuletzt synchronisiert"
 *   - Aktualisieren-Button → POST /api/canva/refresh
 *   - Platzhalter-Chips mit Edit-Pipeline-Erfolgsbanner
 *   - "Andere PPTX-Datei hochladen" öffnet den Import-Dialog (Re-Import-Modus)
 *
 * Es gibt KEINEN durationMs-Editor hier — der wird vom Wrapper
 * `segment-editor.tsx` über das gemeinsame DurationInput gerendert.
 */

export interface SegmentEditorCanvaProps {
  segment: CanvaSegment;
  onChange: (segment: CanvaSegment) => void;
  /**
   * Verbleibendes Webcam-Budget (ms) — nur relevant für den Re-Import-Dialog.
   * Wird durchgereicht; null = unbekannt (keine UI-Grenze).
   */
  remainingBudgetMs?: number | null;
  /** Mindest-Dauer pro Segment (ms) — für den Re-Import-Dialog. */
  minPerSegmentMs?: number;
}

interface RefreshResponse {
  thumbnailUrl: string | null;
  detectedPlaceholders: string[];
  lastFetchedAt: string;
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

export function SegmentEditorCanva({
  segment,
  onChange,
  remainingBudgetMs,
  minPerSegmentMs,
}: SegmentEditorCanvaProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [reimportOpen, setReimportOpen] = React.useState(false);

  // „vor X Min" soll sich nach 30 s automatisch aktualisieren.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 30_000);
    return () => clearInterval(id);
  }, []);

  async function handleRefresh() {
    if (refreshing) return;
    if (!segment.pptxMediaId) {
      setRefreshError(
        "Keine PPTX-Quelle hinterlegt — neues Segment importieren.",
      );
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/canva/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pptxMediaId: segment.pptxMediaId,
          slideIndex: segment.slideIndex,
        }),
      });
      if (!res.ok) {
        let msg = "Aktualisieren fehlgeschlagen.";
        try {
          const parsed = (await res.json()) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch {
          /* body was not json */
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
        lastFetchedAt: data.lastFetchedAt ?? new Date().toISOString(),
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

  // Re-Import: User hat im Dialog eine neue PPTX hochgeladen + (genau)
  // eine Folie ausgewählt. Wir ersetzen die Felder dieses Segments in
  // place, damit die Timeline-Position erhalten bleibt.
  function handleReimport(newSegments: CanvaSegment[]) {
    if (newSegments.length === 0) return;
    const replacement = newSegments[0];
    onChange({
      ...segment,
      pptxMediaId: replacement.pptxMediaId,
      pptxPublicUrl: replacement.pptxPublicUrl,
      fileName: replacement.fileName,
      slideIndex: replacement.slideIndex,
      thumbnailUrl: replacement.thumbnailUrl,
      detectedPlaceholders: replacement.detectedPlaceholders,
      lastFetchedAt: replacement.lastFetchedAt,
    });
    setReimportOpen(false);
    toast({
      variant: "success",
      title: "Folie ersetzt",
      description: replacement.fileName
        ? `${replacement.fileName} · Folie ${replacement.slideIndex + 1}`
        : `Folie ${replacement.slideIndex + 1} wurde übernommen.`,
    });
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
          <Wand2 className="size-3" />
          Folie {segment.slideIndex + 1}
        </span>
      </div>

      {/* Sync-Zeile */}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-ink-muted">
          <span className="block truncate font-medium text-ink">
            {segment.fileName
              ? `${segment.fileName} · Folie ${segment.slideIndex + 1}`
              : `Folie ${segment.slideIndex + 1} aus PPTX`}
          </span>
          <span className="block text-[11px] text-ink-muted/80">
            Stand: {formatRelative(segment.lastFetchedAt)}
          </span>
        </p>
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
        <p className="mb-2 text-xs font-medium text-ink">Platzhalter</p>
        {segment.detectedPlaceholders.length === 0 ? (
          <p className="text-xs leading-snug text-ink-muted">
            Keine <code className="font-mono">{"{{key}}"}</code>-Platzhalter
            auf dieser Folie — sie wird unverändert gezeigt.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {segment.detectedPlaceholders.map((key) => (
                <span
                  key={key}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium",
                    "border-brand-200 bg-brand-soft text-brand-deep",
                  )}
                  title={`Wird pro Lead ersetzt: {{${key}}}`}
                >
                  {`{{${key}}}`}
                </span>
              ))}
            </div>
            <p className="text-xs leading-snug text-ink-muted">
              Werden pro Lead automatisch mit den Daten aus deiner Leadliste
              ersetzt.
            </p>
          </>
        )}
      </div>

      {/* Inline-Error */}
      {refreshError && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span className="leading-snug">{refreshError}</span>
        </div>
      )}

      {/* Re-Import */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setReimportOpen(true)}
        iconLeft={<Upload className="size-3.5" />}
        className="w-full"
      >
        Andere PPTX-Datei hochladen
      </Button>

      {/* Re-Import-Dialog. Wird im Single-Select-Modus genutzt. */}
      <CanvaImportDialog
        open={reimportOpen}
        onOpenChange={setReimportOpen}
        remainingBudgetMs={remainingBudgetMs ?? null}
        minPerSegmentMs={minPerSegmentMs ?? 200}
        onAddSegments={handleReimport}
        replaceMode
      />
    </div>
  );
}
