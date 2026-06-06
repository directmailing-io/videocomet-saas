"use client";

import * as React from "react";
import {
  Video,
  Check,
  Upload,
  RotateCcw,
  Loader2,
  Play,
  AlertCircle,
  Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  WebcamRecorder,
  type RecordedMedia,
} from "@/components/ui/webcam-recorder";
import { cn } from "@/lib/utils";

interface Webcam {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
  /** "webcam" = recorded via the in-app recorder.
   *  "video"  = uploaded directly to the media library.
   *  Both behave identically downstream; this only drives the subtle UI
   *  badge so users can spot which is which. */
  kind: "webcam" | "video";
  /** Native source dimensions (ffprobe at upload time). Both NULL → unknown;
   *  UI falls back to landscape (16:9) so legacy items render as before. */
  width: number | null;
  height: number | null;
}

export interface WizardStep1Props {
  webcams: Webcam[];
  value: string | null;
  onChange: (id: string) => void;
  /** Called when a new webcam recording is added so the parent can keep its
   *  webcam list in sync (e.g. for the summary step). Optional for back-compat. */
  onWebcamsChange?: (webcams: Webcam[]) => void;
}

interface MediaApiItem {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
  type: "webcam" | "video" | "image" | "logo";
  width: number | null;
  height: number | null;
}

function durationLabel(seconds: number | null): string {
  if (!seconds) return "Webcam";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * KindBadge — winziges Pill, das den Ursprung der Datei zeigt:
 *   - "Webcam" für In-App-Aufnahmen (Brand-Soft, weil Standard-Pfad)
 *   - "Upload" für Mediathek-Uploads (neutral Line, weniger prominent)
 *
 * Bewusst dezent: Lesbar aber nicht aufdringlich, damit die Thumbnails
 * weiter fürs Video-Bild stehen, nicht für Meta-Info.
 */
function KindBadge({
  kind,
  className,
}: {
  kind: "webcam" | "video";
  className?: string;
}) {
  const isUpload = kind === "video";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        isUpload
          ? "border-line bg-surface text-ink-muted"
          : "border-brand/30 bg-brand-soft text-brand-deep",
        className,
      )}
      title={isUpload ? "Aus Mediathek hochgeladen" : "Webcam-Aufnahme"}
    >
      {isUpload ? (
        <Film className="size-2.5" />
      ) : (
        <Video className="size-2.5" />
      )}
      {isUpload ? "Upload" : "Webcam"}
    </span>
  );
}

/**
 * FormatBadge — kleines Pill mit Aspect-Ratio des Source-Videos.
 *
 * Hilft beim schnellen Erkennen, ob ein Asset für Shorts/Reels (9:16),
 * klassische Outreach (16:9) oder Square (1:1) gedacht ist — ohne dass
 * man das Thumbnail genauer ansehen muss.
 *
 * Legacy-Items vor Migration 0011 haben width=height=null → wir rendern
 * dann kein Badge (lieber leer als falsch).
 */
function FormatBadge({
  width,
  height,
  className,
}: {
  width: number | null;
  height: number | null;
  className?: string;
}) {
  if (width == null || height == null) return null;
  if (width <= 0 || height <= 0) return null;

  let label: string;
  let title: string;
  if (width > height) {
    label = "16:9";
    title = "Querformat (Landscape)";
  } else if (height > width) {
    label = "9:16";
    title = "Hochformat (Portrait)";
  } else {
    label = "1:1";
    title = "Quadratisch";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-brand/30 bg-brand-soft text-brand-deep px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
        className,
      )}
      title={title}
    >
      {label}
    </span>
  );
}

export function WizardStep1Webcam({
  webcams: initialWebcams,
  value,
  onChange,
  onWebcamsChange,
}: WizardStep1Props) {
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [webcams, setWebcamsLocal] = React.useState<Webcam[]>(initialWebcams);
  const setWebcams = React.useCallback(
    (next: Webcam[] | ((prev: Webcam[]) => Webcam[])) => {
      setWebcamsLocal((prev) => {
        const v = typeof next === "function" ? (next as (p: Webcam[]) => Webcam[])(prev) : next;
        onWebcamsChange?.(v);
        return v;
      });
    },
    [onWebcamsChange],
  );
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  const selected = React.useMemo(
    () => webcams.find((w) => w.id === value) ?? null,
    [webcams, value],
  );

  // When the user opens the picker, refresh the webcam list from the API so
  // newly uploaded items appear without a full page reload.
  const loadPickerItems = React.useCallback(async () => {
    setPickerLoading(true);
    setPickerError(null);
    try {
      // Step 1 accepts both: classic recordings ("webcam") and direct video
      // uploads from the media library ("video"). Both serve as the spoken
      // segment source, so the picker shows them together with a small badge.
      const res = await fetch("/api/media?type=webcam,video", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: MediaApiItem[] };
      setWebcams(
        (data.items ?? []).map((it) => ({
          id: it.id,
          name: it.name,
          publicUrl: it.publicUrl,
          durationSec: it.durationSec ?? null,
          kind: it.type === "video" ? "video" : "webcam",
          width: it.width ?? null,
          height: it.height ?? null,
        })),
      );
    } catch (err) {
      console.error("[wizard-step1] load media failed:", err);
      setPickerError(
        err instanceof Error
          ? err.message
          : "Mediathek konnte nicht geladen werden.",
      );
    } finally {
      setPickerLoading(false);
    }
  }, []);

  function openPicker() {
    setPickerOpen(true);
    void loadPickerItems();
  }

  // The WebcamRecorder uploads the media itself and gives us back the saved
  // record. We just stitch it into the local list and select it.
  function handleRecorderConfirm(media: RecordedMedia) {
    const newItem: Webcam = {
      id: media.id,
      name: media.name,
      publicUrl: media.publicUrl,
      durationSec: media.durationSec ?? null,
      // The in-app recorder always creates a `webcam`-type media item.
      kind: "webcam",
      // The recorder doesn't surface the probed dimensions in its callback
      // payload. Leaving as null = "unknown" → fallback to landscape in the
      // preview. The picker-refresh path below picks up the persisted values
      // from the API when the user navigates away & back.
      width: media.width ?? null,
      height: media.height ?? null,
    };
    setWebcams((prev) => [newItem, ...prev.filter((w) => w.id !== newItem.id)]);
    onChange(newItem.id);
    setRecordOpen(false);
    setUploadError(null);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">
        Webcam-Video wählen
      </h2>
      <p className="text-sm text-ink-muted mb-6">
        Wähle eine vorhandene Webcam-Aufnahme oder ein hochgeladenes Video
        aus deiner Mediathek — oder nimm jetzt eine neue Aufnahme auf.
      </p>

      {selected ? (
        <SelectedWebcamPreview
          webcam={selected}
          onPickOther={openPicker}
          onReRecord={() => {
            setUploadError(null);
            setRecordOpen(true);
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink-muted">
              {webcams.length === 0
                ? "Du hast noch keine Webcam-Aufnahme oder kein Video."
                : "Wähle eine Aufnahme oder ein Video aus deiner Mediathek."}
            </div>
            <div className="flex flex-wrap gap-2">
              {webcams.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openPicker}
                  iconLeft={<Upload className="size-4" />}
                >
                  Aus Mediathek wählen
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setUploadError(null);
                  setRecordOpen(true);
                }}
                iconLeft={<Video className="size-4" />}
              >
                Neu aufnehmen
              </Button>
            </div>
          </div>

          {webcams.length === 0 ? (
            <EmptyState
              icon={<Video />}
              title="Keine Webcam-Aufnahmen"
              subtitle="Nimm jetzt deine erste Webcam-Aufnahme auf, um sie hier auswählen zu können."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {webcams.map((w) => (
                <WebcamThumb
                  key={w.id}
                  webcam={w}
                  active={w.id === value}
                  onSelect={() => onChange(w.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Picker dialog (Mediathek) */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Aus Mediathek wählen</DialogTitle>
            <DialogDescription>
              Klicke eine Webcam-Aufnahme oder ein hochgeladenes Video an, um
              es für diese Kampagne zu verwenden.
            </DialogDescription>
          </DialogHeader>
          {pickerLoading ? (
            <div className="py-12 text-center text-sm text-ink-muted">
              Lade ...
            </div>
          ) : pickerError ? (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 p-6 text-center">
              <p className="text-sm font-semibold text-ink mb-1">
                Mediathek konnte nicht geladen werden
              </p>
              <p className="text-xs text-ink-muted mb-3">{pickerError}</p>
              <Button size="sm" onClick={loadPickerItems}>
                Erneut versuchen
              </Button>
            </div>
          ) : webcams.length === 0 ? (
            <EmptyState
              icon={<Video />}
              title="Keine Webcam-Aufnahmen"
              subtitle="Nimm jetzt deine erste Webcam-Aufnahme auf."
              action={
                <Button
                  onClick={() => {
                    setPickerOpen(false);
                    setUploadError(null);
                    setRecordOpen(true);
                  }}
                  iconLeft={<Video className="size-4" />}
                >
                  Neu aufnehmen
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
              {webcams.map((w) => (
                <WebcamThumb
                  key={w.id}
                  webcam={w}
                  active={w.id === value}
                  onSelect={() => {
                    onChange(w.id);
                    setPickerOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recorder dialog */}
      <Dialog
        open={recordOpen}
        onOpenChange={(o) => {
          if (uploading) return;
          setRecordOpen(o);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Webcam-Aufnahme</DialogTitle>
            <DialogDescription>
              Achte auf gute Beleuchtung und ein neutrales Setup.
            </DialogDescription>
          </DialogHeader>
          {uploadError && (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {uploadError}
            </div>
          )}
          {uploading && (
            <div className="rounded-squircle-md border border-line bg-surface-soft px-4 py-3 text-sm text-ink-muted flex items-center gap-2">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              Upload läuft ...
            </div>
          )}
          {recordOpen && (
            <WebcamRecorder
              onConfirm={handleRecorderConfirm}
              onCancel={() => {
                if (!uploading) setRecordOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-Components                                                     */
/* ------------------------------------------------------------------ */

/**
 * SelectedWebcamPreview — die große Vorschau, die nach Auswahl einer Webcam
 * angezeigt wird. Anders als die alte Variante:
 *   - controls + preload="metadata" + playsInline → spielt zuverlässig ab
 *     (auch in Safari/iOS und kurz nach dem Upload, wenn Bunny Edge noch warm
 *     wird)
 *   - explizite Lade- und Fehlerzustände, damit der Nutzer nicht denkt,
 *     der Player sei kaputt
 *   - „Erneut versuchen" wenn das CDN den Range-Request mal versemmelt
 */
function SelectedWebcamPreview({
  webcam,
  onPickOther,
  onReRecord,
}: {
  webcam: Webcam;
  onPickOther: () => void;
  onReRecord: () => void;
}) {
  const [loadState, setLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reloadKey, setReloadKey] = React.useState(0);
  // Client-side fallback wenn die Server-Werte für Altbestand fehlen — wir
  // ermitteln Aspect aus dem geladenen <video>-Element und nutzen es für den
  // Container-Aspect (rein lokal, wird nicht zurückgeschrieben).
  const [detectedDims, setDetectedDims] = React.useState<
    { width: number; height: number } | null
  >(null);

  // Wenn sich die Auswahl ändert (anderes Video), zurück in den Lade-Status.
  React.useEffect(() => {
    setLoadState("loading");
    setDetectedDims(null);
  }, [webcam.id]);

  /** Effektives Aspect: bevorzugt DB-Werte, dann Client-Detection. */
  const effectiveDims =
    webcam.width != null && webcam.height != null
      ? { width: webcam.width, height: webcam.height }
      : detectedDims;
  const isPortrait =
    effectiveDims !== null && effectiveDims.height > effectiveDims.width;

  /**
   * Bunny-Stream-GUID aus der publicUrl extrahieren (Pattern:
   * `vz-<hash>.b-cdn.net/<guid>/playlist.m3u8`). Wenn die URL kein
   * Stream-Pattern matcht, ist es eine Storage-URL (Webcam-Recording)
   * und wir streamen direkt via <video>.
   */
  const streamGuid = React.useMemo(() => {
    const m = webcam.publicUrl.match(
      /^https?:\/\/[^/]+\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i,
    );
    return m ? m[1] : null;
  }, [webcam.publicUrl]);

  // Bei iframe-Embed feuert onLoad selbst dann wenn ein Error-Page angezeigt
  // wird — wir verlassen uns auf den Initial-Load und gehen sofort auf ready,
  // sobald die iframe geladen ist (kein server-side Status-Check noetig).
  React.useEffect(() => {
    if (streamGuid) setLoadState("ready");
  }, [streamGuid, reloadKey]);

  return (
    <div className="rounded-squircle-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep">
          <Check className="size-3.5" />
          Ausgewählt
        </span>
        <span className="text-sm font-semibold text-ink truncate">
          {webcam.name}
        </span>
        <KindBadge kind={webcam.kind} />
        <FormatBadge width={webcam.width} height={webcam.height} />
        <span className="text-xs text-ink-muted">
          {durationLabel(webcam.durationSec)}
        </span>
        {webcam.durationSec == null && loadState !== "error" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
            <Loader2 className="size-3 animate-spin" />
            Dauer wird ermittelt
          </span>
        )}
      </div>

      {/*
       * Container-Aspect richtet sich nach der gemessenen Source. Portrait
       * (height > width) → schmaleres 9:16-Fenster mit gedeckelter Höhe, sonst
       * klassisches 16:9. Wenn width/height noch unbekannt sind (Altbestand
       * vor Migration 0011 oder Probe fehlgeschlagen), bleibt es bei 16:9
       * — entspricht dem alten Verhalten.
       */}
      <div
        className={cn(
          "relative overflow-hidden rounded-squircle-sm bg-ink",
          isPortrait
            ? "w-full max-w-[280px] aspect-[9/16] max-h-[60vh]"
            : "w-full max-w-[480px] aspect-video",
        )}
      >
        {streamGuid ? (
          // Bunny-Stream-URLs (Mediathek-Upload kind=video) haben Token-Auth +
          // Hotlink-Protection — direktes <video src=...> bekommt 403/404.
          // Wir nutzen Bunnys iframe-Player; der hat eigene Auth und braucht
          // keinen Token-Key.
          <iframe
            key={`${webcam.id}-${reloadKey}`}
            src={`https://iframe.mediadelivery.net/embed/670919/${streamGuid}`}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full bg-ink border-0"
            title={webcam.name}
            onLoad={() => setLoadState("ready")}
            onError={() => setLoadState("error")}
          />
        ) : (
          // Bunny-Storage-URLs (Webcam-Recording, kind=webcam) sind direkt
          // streambar — kein iframe nötig.
          <video
            key={`${webcam.id}-${reloadKey}`}
            src={webcam.publicUrl}
            controls
            controlsList="nodownload"
            preload="metadata"
            playsInline
            className="h-full w-full object-contain bg-ink"
            onLoadedMetadata={(e) => {
              setLoadState("ready");
              const v = e.currentTarget as HTMLVideoElement;
              if ((webcam.width == null || webcam.height == null) && v.videoWidth > 0 && v.videoHeight > 0) {
                setDetectedDims({ width: v.videoWidth, height: v.videoHeight });
              }
            }}
            onLoadedData={() => setLoadState("ready")}
            onError={() => setLoadState("error")}
          />
        )}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/60 text-white pointer-events-none">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-xs font-medium">Vorschau wird geladen …</span>
          </div>
        )}
        {loadState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/85 p-4 text-center text-white">
            <AlertCircle className="size-6" />
            <span className="text-sm font-semibold">
              Vorschau konnte nicht geladen werden
            </span>
            <span className="text-[11px] text-white/70 max-w-xs">
              Das Video wurde gespeichert. Klick „Erneut laden" — das CDN
              braucht manchmal ein paar Sekunden.
            </span>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                setLoadState("loading");
                setReloadKey((k) => k + 1);
              }}
              iconLeft={<RotateCcw className="size-3.5" />}
            >
              Erneut laden
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPickOther}
          iconLeft={<RotateCcw className="size-4" />}
        >
          Andere wählen
        </Button>
        <Button
          size="sm"
          variant="subtle"
          onClick={onReRecord}
          iconLeft={<Video className="size-4" />}
        >
          Neu aufnehmen
        </Button>
      </div>
    </div>
  );
}

/**
 * WebcamThumb — Grid-Tile in der Mediathek-Übersicht / im Picker-Dialog.
 *
 * Lade-Logik:
 *   Statt das <video> direkt mit preload="metadata" zu rendern (was bei vielen
 *   Bunny-Range-Requests parallel zum Stocken führen kann), zeigen wir erst
 *   ein dunkles Tile mit Play-Icon. Erst beim Hover wird das Video tatsächlich
 *   geladen — das ist genug, damit der Nutzer eine visuelle Bestätigung sieht,
 *   dass das Video „da ist", ohne dass der ganze Grid um Bandbreite kämpft.
 */
function WebcamThumb({
  webcam,
  active,
  onSelect,
}: {
  webcam: Webcam;
  active: boolean;
  onSelect: () => void;
}) {
  const [loadState, setLoadState] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  function startLoad() {
    if (loadState !== "idle") return;
    setLoadState("loading");
    const el = videoRef.current;
    if (el && !el.src) {
      el.src = webcam.publicUrl;
      try {
        el.load();
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={startLoad}
      onFocus={startLoad}
      title={`${webcam.name} (${durationLabel(webcam.durationSec)})`}
      className={cn(
        "text-left rounded-squircle-md border transition-all duration-200 ease-spring",
        active
          ? "border-brand ring-2 ring-brand/30"
          : "border-line hover:border-brand/50",
      )}
    >
      <Card className="border-0 shadow-none bg-transparent">
        <CardContent className="p-3">
          <div className="relative aspect-video rounded-squircle-sm bg-ink mb-2 overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              preload="none"
              muted
              playsInline
              className={cn(
                "w-full h-full object-cover transition-opacity",
                loadState === "ready" ? "opacity-100" : "opacity-0",
              )}
              onLoadedData={() => setLoadState("ready")}
              onError={() => setLoadState("error")}
            />
            {loadState !== "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/70">
                {loadState === "loading" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : loadState === "error" ? (
                  <AlertCircle className="size-5 text-warn" />
                ) : (
                  <Play className="size-6 fill-current" />
                )}
                <span className="text-[10px] font-medium">
                  {loadState === "loading"
                    ? "Lädt …"
                    : loadState === "error"
                    ? "nicht verfügbar"
                    : "Webcam"}
                </span>
              </div>
            )}
            {active && (
              <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white shadow">
                <Check className="size-3" />
              </span>
            )}
            {/* Format-Badge oben rechts. Bei aktivem Tile (Check-Pill nimmt
             * die Ecke) rutscht das Badge eine Reihe runter, damit es nicht
             * unter dem Check verschwindet. */}
            <FormatBadge
              width={webcam.width}
              height={webcam.height}
              className={cn(
                "absolute right-1.5 shadow-sm backdrop-blur-sm",
                active ? "top-7" : "top-1.5",
              )}
            />
            <KindBadge
              kind={webcam.kind}
              className="absolute left-1.5 top-1.5 shadow-sm backdrop-blur-sm"
            />
          </div>
          <p className="text-sm font-semibold text-ink truncate">
            {webcam.name}
          </p>
          <p className="text-xs text-ink-muted">
            {durationLabel(webcam.durationSec)}
          </p>
        </CardContent>
      </Card>
    </button>
  );
}
