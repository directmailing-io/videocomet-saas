"use client";

import * as React from "react";
import {
  Video,
  Check,
  Upload,
  Loader2,
  Play,
  AlertCircle,
  Film,
  Sparkles,
  Clapperboard,
  Monitor,
} from "lucide-react";
import { RecordingHint } from "@/components/intro/recording-hint";
import { StudioWordmark } from "@/components/studio/studio-wordmark";
import { Button } from "@/components/ui/button";
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
  /** Aufnahme-Tipp für die personalisierte KI-Begrüßung im Recorder
   *  einblenden (kollabierbar). Nur wenn der User das Feature aktivieren will. */
  showKiHint?: boolean;
  /**
   * Wenn gesetzt, zeigt Schritt 0 zwei gleichrangige Options-Karten
   * („VIDEOCOMET Studio" und „Klassischer Editor"). Klick auf die
   * Studio-Karte ruft diesen Callback auf — der Container öffnet dann den
   * StudioFlow als Vollbild-Overlay. Optional für Back-Compat mit älteren
   * Callsites (ohne Callback erscheint die Mediathek direkt, ohne Karten).
   */
  onStartStudio?: () => void;
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none",
        isUpload
          ? "bg-surface text-ink-muted"
          : "bg-brand-soft text-brand-deep",
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
        "inline-flex items-center rounded-full bg-brand-soft text-brand-deep px-2 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
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
  showKiHint = false,
  onStartStudio,
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

  // Klassischer Weg gewählt? Initial true bei bereits gewähltem Video
  // (Wizard-Entwurf) oder bei alten Callsites ohne Studio — dann zeigen wir
  // die Mediathek wie bisher direkt, ohne Options-Karten davor.
  const [classicChosen, setClassicChosen] = React.useState(
    () => value != null || !onStartStudio,
  );
  const mediaSectionRef = React.useRef<HTMLDivElement | null>(null);

  function chooseClassic() {
    setClassicChosen(true);
    // Der Mediathek-Bereich mountet erst nach dem State-Update — deshalb
    // sanft scrollen im nächsten Macrotask (React hat bis dahin committet).
    window.setTimeout(() => {
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 0);
  }

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
      <div className="space-y-4">
          {onStartStudio && (
            <RecordingEntryCards
              onStartStudio={onStartStudio}
              onChooseClassic={chooseClassic}
              classicChosen={classicChosen}
            />
          )}
          {classicChosen && (
            <div ref={mediaSectionRef} className="space-y-4 scroll-mt-24">
              <KiRecordingTeaser />
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
                    variant="subtle"
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
                <div className="grid grid-cols-2 gap-4">
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
        </div>

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
            <div className="rounded-squircle-md bg-danger-soft/60 p-6 text-center">
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
            <div className="rounded-squircle-md bg-danger-soft/60 px-4 py-3 text-sm text-danger">
              {uploadError}
            </div>
          )}
          {uploading && (
            <div className="rounded-squircle-md bg-surface-soft px-4 py-3 text-sm text-ink-muted flex items-center gap-2">
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
              showKiHint={showKiHint}
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
 * useIsDesktop — matchMedia-Hook für die Studio-Verfügbarkeit.
 *
 * Studio braucht Platz (Bühne + Tab-Leiste + Teleprompter) und eine
 * physische Tastatur — unter 1024px graut die Karte aus und der klassische
 * Flow bleibt der Weg. SSR-Default ist `true` (Desktop), damit auf dem
 * typischen Laptop kein Flackern beim Hydrieren entsteht.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}

/**
 * RecordingEntryCards — Options-Karten in Schritt 0 mit klarer Hierarchie:
 *
 *   • „VIDEOCOMET Studio" (primär, empfohlen): violette Premium-Optik,
 *     zentrierter Inhalt, Ink-Pill-CTA — Klick öffnet den StudioFlow als
 *     Vollbild-Overlay (Callback in den Container). Unter 1024px ausgegraut
 *     (Desktop-Guard).
 *   • „Klassischer Editor" (sekundär, bewusst zurückgenommen): für alle,
 *     die ihr Video schon haben — Klick blendet die Mediathek-Auswahl
 *     darunter ein (`classicChosen`). Lebt beim Hover leicht auf.
 */
function RecordingEntryCards({
  onStartStudio,
  onChooseClassic,
  classicChosen,
}: {
  onStartStudio: () => void;
  onChooseClassic: () => void;
  classicChosen: boolean;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-stretch">
      {/* VIDEOCOMET Studio — primär, violette Premium-Optik, zentriert */}
      <button
        type="button"
        onClick={() => {
          if (isDesktop) onStartStudio();
        }}
        disabled={!isDesktop}
        aria-disabled={!isDesktop}
        className={cn(
          "group relative flex flex-col items-center rounded-squircle-xl bg-gradient-to-b from-brand-soft to-white p-7 text-center ring-1 ring-brand/30 shadow-lift transition-all duration-200 ease-spring sm:col-span-3 sm:p-8",
          isDesktop
            ? "hover:-translate-y-0.5 hover:ring-brand/50"
            : "opacity-60 cursor-not-allowed",
        )}
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold leading-none text-brand-deep ring-1 ring-brand/25 backdrop-blur">
          <Sparkles className="size-3" />
          Empfohlen
        </span>
        <span className="sr-only">VIDEOCOMET Studio</span>
        <StudioWordmark height={28} className="mt-4" />
        <span className="mt-3 max-w-sm text-sm text-ink-muted leading-relaxed">
          Noch kein Video? Hier nimmst du es direkt auf. Du sprichst in die
          Kamera, VIDEOCOMET zeigt dabei zum Beispiel die Website deines
          Empfängers. Ohne Schnitt, ohne Vorkenntnisse.
        </span>
        {isDesktop ? (
          <span className="mt-auto pt-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors group-hover:bg-ink/90">
              <Clapperboard className="size-4" />
              Studio öffnen
            </span>
          </span>
        ) : (
          <span className="mt-auto pt-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-white/60 px-4 py-2 text-xs font-medium text-ink-muted">
              <Monitor className="size-3.5" />
              Am besten am Laptop oder Desktop
            </span>
          </span>
        )}
      </button>

      {/* Klassischer Editor — sekundär, bewusst zurückgenommen */}
      <button
        type="button"
        onClick={onChooseClassic}
        className={cn(
          "group flex flex-col text-left rounded-squircle-xl bg-surface-muted p-5 transition-all duration-200 ease-spring hover:bg-surface hover:shadow-card sm:col-span-2 sm:p-6",
          classicChosen && "bg-surface ring-2 ring-brand shadow-card",
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors group-hover:text-ink">
          <Film className="size-4" />
          Klassischer Editor
        </span>
        <span className="mt-2 text-sm text-ink-muted leading-relaxed">
          Video schon fertig? Wähle es aus und gestalte danach alles
          drumherum.
        </span>
        <span className="mt-auto pt-5 self-start">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-muted transition-colors group-hover:border-ink/30 group-hover:text-ink">
            <Video className="size-4" />
            Video auswählen
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * KiRecordingTeaser — Aufnahme-Tipp VOR der Aufnahme.
 *
 * Die KI-Begrüßung wird erst im nächsten Wizard-Schritt gewählt, aber die
 * Sprech-Anleitung muss greifen, bevor das Video im Kasten ist. Deshalb
 * steht hier die Kernregel immer sichtbar, die Beispiel-Karten sind
 * ausklappbar (wer keine KI-Begrüßung will, wird nicht zugetextet).
 */
function KiRecordingTeaser() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-squircle-md border border-line bg-surface">
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <Sparkles className="size-4 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Tipp: Im nächsten Schritt kannst du die persönliche KI-Begrüßung
            aktivieren
          </p>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">
            Dann wird der erste Satz pro Lead mit Vornamen gesprochen, in
            deiner Stimme. Damit das klappt: Fang deine Aufnahme mit einer
            kurzen Anrede an („Hi!", „Hallo!") und sprich danach in einem
            vollständigen Satz weiter.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1 flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-ink-muted hover:text-ink transition-colors"
      >
        <span className="flex-1">
          {open ? "Beispiele ausblenden" : "Beispiele anzeigen"}
        </span>
        <span
          className={cn(
            "text-xs transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-line-soft p-3">
          <RecordingHint compact className="border-0 p-0" />
        </div>
      )}
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
        "text-left rounded-squircle-md bg-surface shadow-card transition-all duration-200 ease-spring",
        active
          ? "ring-2 ring-brand bg-brand-soft/40"
          : "hover:shadow-card-hover hover:-translate-y-0.5",
      )}
    >
      <div className="p-3">
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
      </div>
    </button>
  );
}
