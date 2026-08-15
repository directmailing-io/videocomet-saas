"use client";

/**
 * phase-regie — Phase 1 des Studio-Flows: Szenen anlegen, sortieren und
 * vorbereiten lassen.
 *
 * Die Bühne ist ein Browser-Fenster: Szenen liegen als Tabs in der
 * Chrome-Leiste, ein „+"-Tab öffnet die Neuer-Tab-Seite zum Hinzufügen
 * (Website des Empfängers / Eigene Webseite / Google Docs / Präsentation).
 * Darunter: Einstellungen der gewählten Szene + Teleprompter (opt-in).
 *
 * „Weiter" ist erst aktiv, wenn ≥1 Szene existiert und ALLE bereit sind —
 * die Live-Aufnahme braucht keine Netzwerk-Ladevorgänge mehr.
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileType2,
  Globe,
  Globe2,
  Image as ImageIcon,
  Loader2,
  MonitorUp,
  PlaySquare,
  Plus,
  Presentation,
  ScrollText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StudioTab } from "@/lib/studio/types";
import type { PdfSegment, Segment, TextSegment } from "@/lib/segments/types";
import { friendlyScreenshotError } from "@/lib/screenshot-error-text";
import { normalizeUrlInput, urlInputError } from "@/lib/studio/url-input";
import {
  slugifyUrlColumn,
  websiteSegmentMappingKey,
} from "@/lib/placeholders/website-url";
import {
  createCanvaSegment,
  createGDocsSegment,
  createGSlideSegment,
  createPdfSegment,
  createWebsiteSegment,
} from "@/lib/segments/defaults";
import { StudioStage } from "./studio-stage";
import { SceneKindIcon } from "./scene-icon";
import { StudioWordmark } from "./studio-wordmark";
import {
  clamp01,
  createStudioImageSegment,
  createStudioVideoSegment,
  deckKeyOf,
  deckLabel,
  groupStudioTabs,
  sceneKindOf,
  STUDIO_MEDIA_ACCEPT,
  tabLabel,
  tabThumbUrl,
  uploadCanvaPptxFile,
  uploadStudioMediaFile,
  type StudioSceneKind,
  type UpdateSegmentFn,
} from "./internal";
import type { UseSceneAssetsResult } from "./use-scene-assets";

export interface PhaseRegieProps {
  tabs: StudioTab[];
  onAddTab: (segment: Segment) => void;
  onRemoveTab: (tabId: string) => void;
  onMoveTab: (tabId: string, direction: -1 | 1) => void;
  updateSegment: UpdateSegmentFn;
  assets: UseSceneAssetsResult;
  script: string;
  onScriptChange: (script: string) => void;
  onNext: () => void;
  onCancel: () => void;
}

/** Host einer URL als Anzeigename (Fallback: die URL selbst). */
function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface PdfUploadResponse {
  pdfUrl: string;
  pageUrls: string[];
  pageCount: number;
  docWidth: number;
  docHeight: number;
  fileName: string;
}

interface AddTile {
  kind: StudioSceneKind;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

/** Inhalte, die sich automatisch an jeden Lead anpassen. */
const PERSONALIZED_TILES: AddTile[] = [
  {
    kind: "website",
    label: "Website des Leads",
    hint: "Jeder Lead sieht automatisch seine eigene Website",
    icon: <Globe className="size-4" />,
  },
  {
    kind: "gslide",
    label: "Präsentation (Google Slides)",
    hint: "Deine Folien mit Platzhaltern, pro Lead ausgefüllt",
    icon: <Presentation className="size-4" />,
  },
  {
    kind: "canva",
    label: "PowerPoint-Datei (Canva)",
    hint: "Als .pptx hochladen, Platzhalter pro Lead ausgefüllt",
    icon: <MonitorUp className="size-4" />,
  },
  {
    kind: "gdocs",
    label: "Google Docs",
    hint: "Dein Dokument mit Platzhaltern, pro Lead ausgefüllt",
    icon: <FileText className="size-4" />,
  },
];

/** Inhalte, die in jedem Video identisch sind. */
const STATIC_TILES: AddTile[] = [
  {
    kind: "ownsite",
    label: "Eigene Webseite",
    hint: "Eine feste Webseite, zum Beispiel deine eigene",
    icon: <Globe2 className="size-4" />,
  },
  {
    kind: "pdf",
    label: "PDF-Folien",
    hint: "Folien als PDF hochladen, ohne Platzhalter",
    icon: <FileType2 className="size-4" />,
  },
  {
    kind: "image",
    label: "Bild",
    hint: "Ein Bild als eigene Szene",
    icon: <ImageIcon className="size-4" />,
  },
  {
    kind: "video",
    label: "Video",
    hint: "Startest du live per Klick, mit Ton",
    icon: <PlaySquare className="size-4" />,
  },
];

export function PhaseRegie({
  tabs,
  onAddTab,
  onRemoveTab,
  onMoveTab,
  updateSegment,
  assets,
  script,
  onScriptChange,
  onNext,
  onCancel,
}: PhaseRegieProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    tabs[0]?.id ?? null,
  );
  /** „+"-Tab aktiv: Neuer-Tab-Seite statt Szenen-Vorschau. */
  const [adding, setAdding] = React.useState(tabs.length === 0);
  /** Offenes URL-Eingabe-Formular auf der Neuer-Tab-Seite. */
  const [addForm, setAddForm] = React.useState<
    "website" | "ownsite" | "gdocs" | "gslide" | null
  >(null);
  const [addUrl, setAddUrl] = React.useState("");
  /** Name der weiteren Empfänger-Seite (z. B. „Karriereseite"). */
  const [addPageName, setAddPageName] = React.useState("");
  const [addFormError, setAddFormError] = React.useState<string | null>(null);
  const [pdfUploading, setPdfUploading] = React.useState(false);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  /** Laufender Bild-/Video-Upload (null = keiner). */
  const [mediaUploading, setMediaUploading] = React.useState<
    "image" | "video" | null
  >(null);
  const [mediaProgress, setMediaProgress] = React.useState(0);
  const [mediaError, setMediaError] = React.useState<string | null>(null);
  const mediaInputRef = React.useRef<HTMLInputElement | null>(null);
  /** Welcher Medien-Typ zuletzt geklickt wurde (bestimmt accept + kind). */
  const mediaKindRef = React.useRef<"image" | "video">("image");
  /** Vorschau-Scrollposition pro Szene (nur für die Regie-Vorschau). */
  const previewRatioRef = React.useRef<Map<string, number>>(new Map());
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  // Teleprompter ist opt-in: standardmäßig ausgeblendet, Karte erscheint
  // erst nach Klick auf den Toggle im Kopf (auch bei gespeichertem Skript).
  const [prompterOpen, setPrompterOpen] = React.useState(false);

  // Auswahl reparieren, wenn die gewählte Szene gelöscht wurde.
  React.useEffect(() => {
    if (selectedId && tabs.some((t) => t.id === selectedId)) return;
    setSelectedId(tabs[0]?.id ?? null);
  }, [tabs, selectedId]);

  const selected = tabs.find((t) => t.id === selectedId) ?? null;

  // Tab-Leiste: Folien desselben Decks als EIN Eintrag (reine Anzeige).
  const groups = React.useMemo(() => groupStudioTabs(tabs), [tabs]);
  /** Zuletzt aktive Folie pro Deck — Deck-Tab-Klick kehrt dorthin zurück. */
  const deckPosRef = React.useRef<Map<string, string>>(new Map());
  React.useEffect(() => {
    if (!selectedId) return;
    const tab = tabs.find((t) => t.id === selectedId);
    if (!tab) return;
    const key = deckKeyOf(tab);
    if (key) deckPosRef.current.set(key, selectedId);
  }, [selectedId, tabs]);

  const addScene = (segment: Segment) => {
    onAddTab(segment);
    // Die neue Szene bekommt eine neue Tab-ID im Flow — Auswahl folgt via
    // Effekt, sobald tabs aktualisiert sind (letzte Szene selektieren).
  };

  // Neu hinzugefügte Szene automatisch auswählen + Neuer-Tab-Seite schließen.
  const prevCountRef = React.useRef(tabs.length);
  React.useEffect(() => {
    if (tabs.length > prevCountRef.current) {
      // Erste NEUE Szene wählen — bei Deck-Importen (mehrere Folien auf
      // einmal) startet die Auswahl so auf Folie 1 statt der letzten.
      const firstNew = tabs[prevCountRef.current] ?? tabs[tabs.length - 1];
      setSelectedId(firstNew.id);
      setAdding(false);
    }
    prevCountRef.current = tabs.length;
  }, [tabs]);

  // Mapping-Keys aller bereits vorhandenen personalisierten Website-Szenen
  // (erste Szene = Standard-Key "website"). Basis für den Guard: dieselbe
  // Empfänger-Seite soll nicht doppelt eingebaut werden.
  const personalizedWebsiteKeys = React.useMemo(() => {
    const keys: string[] = [];
    for (const t of tabs) {
      const s = t.segment;
      if (s.kind === "website" && s.personalized !== false) {
        keys.push(websiteSegmentMappingKey(s));
      }
    }
    return keys;
  }, [tabs]);
  const hasRecipientWebsite = personalizedWebsiteKeys.length > 0;

  /** Laufender Google-Slides-Import (dauert je nach Deck 10-60 s). */
  const [gslideImporting, setGslideImporting] = React.useState(false);

  /** Laufender PPTX-Upload + Folien-Scan (LibreOffice, 10-60 s). */
  const [canvaImporting, setCanvaImporting] = React.useState(false);
  const [canvaProgress, setCanvaProgress] = React.useState(0);
  const [canvaError, setCanvaError] = React.useState<string | null>(null);
  const canvaInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadErrorRef = React.useRef<HTMLParagraphElement | null>(null);

  // Fehlermeldung in den sichtbaren Bereich holen, falls der Picker gescrollt ist.
  React.useEffect(() => {
    if (pdfError || mediaError || canvaError) {
      uploadErrorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [pdfError, mediaError, canvaError]);

  const onCanvaFile = async (file: File) => {
    setCanvaImporting(true);
    setCanvaError(null);
    setCanvaProgress(0);
    try {
      const uploadData = await uploadCanvaPptxFile(file, setCanvaProgress);
      setCanvaProgress(100);
      const procRes = await fetch("/api/canva/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pptxMediaId: uploadData.mediaId }),
      });
      const procData = (await procRes.json().catch(() => null)) as {
        error?: string;
        fileName?: string | null;
        slides?: {
          slideIndex: number;
          thumbnailUrl: string | null;
          detectedPlaceholders: string[];
        }[];
      } | null;
      if (!procRes.ok) {
        throw new Error(
          procData?.error ||
            "Die Präsentation konnte nicht verarbeitet werden. Bitte versuche es erneut.",
        );
      }
      const allSlides = procData?.slides ?? [];
      const slides = allSlides.filter((s) => !!s.thumbnailUrl);
      if (slides.length === 0) {
        throw new Error(
          allSlides.length > 0
            ? "Die Folien-Vorschau konnte nicht erzeugt werden. Bitte versuche es in einer Minute erneut."
            : "In der Datei wurden keine Folien gefunden. Prüfe die PPTX-Datei und versuche es erneut.",
        );
      }
      const fileName = procData?.fileName ?? uploadData.fileName ?? null;
      for (const s of slides) {
        const seg = createCanvaSegment({ label: `Folie ${s.slideIndex + 1}` });
        seg.pptxMediaId = uploadData.mediaId;
        seg.pptxPublicUrl = uploadData.publicUrl;
        seg.fileName = fileName;
        seg.slideIndex = s.slideIndex;
        seg.thumbnailUrl = s.thumbnailUrl;
        seg.detectedPlaceholders = s.detectedPlaceholders;
        seg.lastFetchedAt = new Date().toISOString();
        onAddTab(seg);
      }
    } catch (err) {
      setCanvaError(
        err instanceof Error
          ? err.message
          : "Die Präsentation konnte nicht verarbeitet werden.",
      );
    } finally {
      setCanvaImporting(false);
    }
  };

  const submitGSlideForm = async () => {
    const urlErr = urlInputError(addUrl);
    if (urlErr) {
      setAddFormError(urlErr);
      return;
    }
    setGslideImporting(true);
    setAddFormError(null);
    try {
      const res = await fetch("/api/gslides/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ publishedUrl: normalizeUrlInput(addUrl) }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        canonicalUrl?: string;
        slides?: {
          slideIndex: number;
          thumbnailUrl: string | null;
          detectedPlaceholders: string[];
        }[];
      } | null;
      if (!res.ok) {
        if (data?.code === "edit-url") {
          throw new Error(
            "Das ist der Bearbeitungs-Link. Geh in Google Slides auf „Datei“ → „Freigeben“ → „Im Web veröffentlichen“ und kopiere den Link von dort.",
          );
        }
        throw new Error(
          data?.error ||
            "Die Präsentation konnte nicht geladen werden. Bitte versuche es erneut.",
        );
      }
      const slides = (data?.slides ?? []).filter((s) => !!s.thumbnailUrl);
      if (!data?.canonicalUrl || slides.length === 0) {
        throw new Error(
          "In der Präsentation wurden keine Folien gefunden. Prüfe den Link und versuche es erneut.",
        );
      }
      for (const s of slides) {
        const seg = createGSlideSegment({
          label: `Folie ${s.slideIndex + 1}`,
        });
        seg.publishedUrl = data.canonicalUrl;
        seg.slideIndex = s.slideIndex;
        seg.thumbnailUrl = s.thumbnailUrl;
        seg.detectedPlaceholders = s.detectedPlaceholders;
        onAddTab(seg);
      }
      setAddUrl("");
      setAddForm(null);
    } catch (err) {
      setAddFormError(
        err instanceof Error
          ? err.message
          : "Die Präsentation konnte nicht geladen werden.",
      );
    } finally {
      setGslideImporting(false);
    }
  };

  const submitAddForm = () => {
    if (!addForm) return;
    if (addForm === "gslide") {
      void submitGSlideForm();
      return;
    }
    const urlErr = urlInputError(addUrl);
    if (urlErr) {
      setAddFormError(urlErr);
      return;
    }
    const url = normalizeUrlInput(addUrl);
    if (addForm === "website" || addForm === "ownsite") {
      const seg = createWebsiteSegment({ label: hostLabel(url) });
      seg.fallbackUrl = url;
      // "ownsite": feste Webseite für ALLE Empfänger (kein Mapping).
      if (addForm === "ownsite") seg.personalized = false;
      if (addForm === "website" && hasRecipientWebsite) {
        // Zweite Empfänger-Seite (z. B. Karriereseite): braucht einen
        // eigenen Mapping-Key, der beim Versand einer Spalte der
        // Empfängerliste zugeordnet wird.
        const name = addPageName.trim();
        const slug = slugifyUrlColumn(name);
        if (!slug) {
          setAddFormError(
            "Bitte gib an, welche Seite des Leads gezeigt werden soll, zum Beispiel Karriereseite.",
          );
          return;
        }
        if (slug === "website" || personalizedWebsiteKeys.includes(slug)) {
          setAddFormError(
            "Diese Seite des Leads ist schon als Szene vorhanden. Wähle einen anderen Namen, zum Beispiel Karriereseite.",
          );
          return;
        }
        seg.urlColumn = slug;
        seg.label = name;
      }
      addScene(seg);
    } else {
      const seg = createGDocsSegment({ label: "Google Docs" });
      seg.docsUrl = url;
      addScene(seg);
    }
    setAddUrl("");
    setAddPageName("");
    setAddFormError(null);
    setAddForm(null);
  };

  const onTileClick = (kind: StudioSceneKind) => {
    setPdfError(null);
    setMediaError(null);
    setCanvaError(null);
    setAddFormError(null);
    if (kind === "pdf") {
      fileInputRef.current?.click();
      return;
    }
    if (kind === "canva") {
      canvaInputRef.current?.click();
      return;
    }
    if (kind === "image" || kind === "video") {
      mediaKindRef.current = kind;
      const input = mediaInputRef.current;
      if (input) {
        input.accept = STUDIO_MEDIA_ACCEPT[kind];
        input.click();
      }
      return;
    }
    if (
      kind === "website" ||
      kind === "ownsite" ||
      kind === "gdocs" ||
      kind === "gslide"
    ) {
      setAddForm((prev) => (prev === kind ? null : kind));
      setAddUrl("");
      setAddPageName("");
    }
  };

  const onPdfFile = async (file: File) => {
    setPdfUploading(true);
    setPdfError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/pdf-segment/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = `Upload fehlgeschlagen (HTTP ${res.status}).`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as PdfUploadResponse;
      const seg: PdfSegment = createPdfSegment({ label: data.fileName });
      seg.pdfUrl = data.pdfUrl;
      seg.fileName = data.fileName;
      seg.pageUrls = data.pageUrls;
      seg.pageCount = data.pageCount;
      seg.docWidth = data.docWidth;
      seg.docHeight = data.docHeight;
      addScene(seg);
    } catch (err) {
      setPdfError(
        err instanceof Error ? err.message : "PDF-Upload fehlgeschlagen.",
      );
    } finally {
      setPdfUploading(false);
    }
  };

  const onMediaFile = async (file: File) => {
    const kind = mediaKindRef.current;
    setMediaUploading(kind);
    setMediaProgress(0);
    setMediaError(null);
    try {
      const media = await uploadStudioMediaFile(file, kind, setMediaProgress);
      addScene(
        kind === "image"
          ? createStudioImageSegment(media)
          : createStudioVideoSegment(media),
      );
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setMediaUploading(null);
    }
  };

  const canContinue = tabs.length > 0 && assets.allReady;
  const continueTitle = canContinue
    ? undefined
    : tabs.length === 0
      ? "Füge zuerst mindestens eine Szene hinzu."
      : "Bitte warte, bis alle Szenen vorbereitet sind.";

  const showNewTabPage = adding || !selected;
  const selectedGroupIndex = selected
    ? groups.findIndex((g) => g.tabs.some((t) => t.id === selected.id))
    : -1;
  const selectedGroup =
    selectedGroupIndex >= 0 ? groups[selectedGroupIndex] : null;
  const selectedSlideIndex =
    selectedGroup && selected
      ? selectedGroup.tabs.findIndex((t) => t.id === selected.id)
      : -1;
  /** Kachel des offenen URL-Formulars — für die fokussierte Formular-Ansicht. */
  const activeTile = addForm
    ? [...PERSONALIZED_TILES, ...STATIC_TILES].find((t) => t.kind === addForm)
    : null;

  /** Einheitliche Szenen-Kachel; personalisierte Kacheln mit Violett-Akzent. */
  const renderAddTile = (tile: AddTile, personalized: boolean) => {
    const busy =
      (tile.kind === "pdf" && pdfUploading) ||
      (tile.kind === "gslide" && gslideImporting) ||
      (tile.kind === "canva" && canvaImporting) ||
      tile.kind === mediaUploading;
    const activeForm = addForm === tile.kind;
    return (
      <button
        key={tile.kind}
        type="button"
        onClick={() => onTileClick(tile.kind)}
        disabled={busy}
        className={cn(
          "flex min-h-[86px] flex-col items-start gap-1.5 rounded-squircle-md border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-card-hover",
          personalized
            ? activeForm
              ? "border-brand bg-brand-soft"
              : "border-brand/30 bg-brand-soft/40 hover:border-brand/60 hover:bg-brand-soft"
            : activeForm
              ? "border-brand bg-brand-soft"
              : "border-line-soft bg-surface-soft hover:border-line hover:bg-surface-muted",
          busy && "opacity-60",
        )}
      >
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-squircle-sm",
            personalized
              ? "bg-brand/20 text-brand-deep"
              : "bg-surface-muted text-ink-muted",
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : tile.icon}
        </span>
        <span className="flex w-full items-center gap-1.5 text-xs font-bold text-ink">
          {tile.label}
          <Plus className="ml-auto size-3 shrink-0 text-ink-muted" />
        </span>
        <span className="text-[10px] leading-snug text-ink-muted">
          {busy
            ? tile.kind === "gslide"
              ? "Folien werden geladen…"
              : tile.kind === "canva"
                ? canvaProgress < 100
                  ? `Wird hochgeladen… ${canvaProgress} %`
                  : "Folien werden vorbereitet…"
                : tile.kind === mediaUploading && mediaProgress > 0
                  ? `Wird hochgeladen… ${mediaProgress} %`
                  : "Wird hochgeladen…"
            : tile.hint}
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Kopfzeile */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-3">
          <StudioWordmark />
          <span className="text-sm font-medium text-ink-muted">Regie</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPrompterOpen((o) => !o)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              prompterOpen
                ? "bg-brand-soft text-brand-deep"
                : "text-ink-muted hover:bg-canvas-deep hover:text-ink",
            )}
          >
            <ScrollText className="size-3.5" />
            Teleprompter
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink"
          >
            <X className="size-3.5" />
            Abbrechen
          </button>
        </div>
      </header>

      {/* Browser-Fenster + Detailkarten */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-4">
        <div
          className="flex w-full flex-col gap-3"
          style={{ maxWidth: "max(720px, calc((100vh - 380px) * 16 / 9))" }}
        >
          <div className="flex flex-col overflow-hidden rounded-squircle-xl bg-surface shadow-lift">
            {/* Chrome-Leiste: Ampel + Szenen-Tabs + „+"-Tab */}
            <div className="flex h-11 shrink-0 items-stretch gap-3 border-b border-line-soft bg-surface-soft pl-4 pr-3">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[#f0b9b4]" />
                <span className="size-2.5 rounded-full bg-[#f0dcae]" />
                <span className="size-2.5 rounded-full bg-[#bcdcc0]" />
              </span>

              <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1.5">
                {groups.map((group, gi) => {
                  const isDeck = !!group.deckKey;
                  const rememberedId = group.deckKey
                    ? deckPosRef.current.get(group.deckKey)
                    : undefined;
                  const tab =
                    group.tabs.find((t) => t.id === selectedId) ??
                    group.tabs.find((t) => t.id === rememberedId) ??
                    group.tabs[0];
                  const pos = group.tabs.indexOf(tab);
                  const active =
                    !showNewTabPage &&
                    group.tabs.some((t) => t.id === selectedId);
                  const statuses = group.tabs.map(
                    (t) => assets.statusById[t.id] ?? "loading",
                  );
                  const status = statuses.includes("error")
                    ? "error"
                    : statuses.includes("loading")
                      ? "loading"
                      : "ready";
                  const thumb = tabThumbUrl(tab);
                  const selectSlide = (id: string) => {
                    setAdding(false);
                    setSelectedId(id);
                  };
                  return (
                    <div
                      key={group.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectSlide(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") selectSlide(tab.id);
                      }}
                      className={cn(
                        "group flex h-full shrink-0 cursor-pointer items-center gap-2 rounded-t-[10px] px-3 transition-colors",
                        active
                          ? "-mb-px border border-b-0 border-line-soft bg-surface"
                          : "text-ink-muted hover:bg-canvas-deep/70",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[10px] font-bold tabular-nums",
                          active ? "text-brand-deep" : "text-ink-muted/70",
                        )}
                      >
                        {gi + 1}
                      </span>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className="h-[18px] w-7 shrink-0 rounded-[4px] object-cover object-top"
                        />
                      ) : tab.segment.kind === "text" ? (
                        <span
                          className="h-[18px] w-7 shrink-0 rounded-[4px] border border-line-soft"
                          style={{ backgroundColor: tab.segment.bgColor }}
                        />
                      ) : (
                        <SceneKindIcon
                          kind={sceneKindOf(tab)}
                          className="size-3.5 shrink-0 text-ink-muted"
                        />
                      )}
                      <span
                        className={cn(
                          "max-w-[130px] truncate text-xs",
                          active
                            ? "font-semibold text-ink"
                            : "font-medium text-ink-muted",
                        )}
                      >
                        {isDeck ? deckLabel(group) : tabLabel(tab)}
                      </span>
                      {isDeck && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label="Vorherige Folie"
                            disabled={pos <= 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectSlide(group.tabs[pos - 1].id);
                            }}
                            className="rounded-full p-0.5 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronLeft className="size-3" />
                          </button>
                          <span
                            className={cn(
                              "text-[10px] font-semibold tabular-nums",
                              active ? "text-ink" : "text-ink-muted",
                            )}
                          >
                            {pos + 1}/{group.tabs.length}
                          </span>
                          <button
                            type="button"
                            aria-label="Nächste Folie"
                            disabled={pos >= group.tabs.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectSlide(group.tabs[pos + 1].id);
                            }}
                            className="rounded-full p-0.5 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronRight className="size-3" />
                          </button>
                        </span>
                      )}
                      {status === "loading" && (
                        <Loader2 className="size-3 shrink-0 animate-spin text-ink-muted" />
                      )}
                      {status === "error" && (
                        <AlertCircle className="size-3 shrink-0 text-danger" />
                      )}
                      <button
                        type="button"
                        aria-label={
                          isDeck ? "Präsentation löschen" : "Szene löschen"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            isDeck &&
                            group.tabs.length > 1 &&
                            !window.confirm(
                              `Die ganze Präsentation (${group.tabs.length} Folien) aus dem Video entfernen?`,
                            )
                          ) {
                            return;
                          }
                          for (const t of group.tabs) onRemoveTab(t.id);
                        }}
                        className="shrink-0 rounded-full p-0.5 text-ink-muted/0 transition-colors hover:bg-canvas-deep hover:text-ink group-hover:text-ink-muted"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}

                {/* „+"-Tab: neue Szene (Browser-Metapher) */}
                <button
                  type="button"
                  aria-label="Szene hinzufügen"
                  onClick={() => {
                    setAdding(true);
                    setAddForm(null);
                    setPdfError(null);
                  }}
                  className={cn(
                    "flex h-full shrink-0 items-center gap-1.5 rounded-t-[10px] px-3 text-xs font-semibold transition-colors",
                    showNewTabPage
                      ? "-mb-px border border-b-0 border-line-soft bg-surface text-brand-deep"
                      : "text-ink-muted hover:bg-canvas-deep/70 hover:text-ink",
                  )}
                >
                  <Plus className="size-3.5" />
                  {tabs.length === 0 && "Neue Szene"}
                </button>
              </div>
            </div>

            {/* Fensterinhalt: Neuer-Tab-Seite oder Szenen-Vorschau */}
            <div className="relative aspect-video w-full">
              {showNewTabPage ? (
                <div className="absolute inset-0 overflow-y-auto bg-surface">
                  <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-4 px-6 py-8">
                    {!addForm && (
                      <>
                    {tabs.length === 0 ? (
                      <>
                        <div className="text-center">
                          <h2 className="text-base font-bold text-ink">
                            Willkommen im Studio
                          </h2>
                          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                            Hier entsteht dein Video in drei Schritten, ganz
                            ohne Schnitt:
                          </p>
                        </div>
                        <ol className="grid w-full grid-cols-3 gap-2">
                          {[
                            {
                              title: "Szenen vorbereiten",
                              text: "Wähle unten, was dein Video zeigen soll, zum Beispiel die Website deines Leads.",
                            },
                            {
                              title: "Einmal aufnehmen",
                              text: "Du sprichst in die Kamera und wechselst live zwischen deinen Szenen.",
                            },
                            {
                              title: "Fertig",
                              text: "Kein Schnitt nötig. Jeder Lead bekommt automatisch sein persönliches Video.",
                            },
                          ].map((step, i) => (
                            <li
                              key={step.title}
                              className="rounded-squircle-md bg-surface-soft p-3"
                            >
                              <span className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand-deep">
                                {i + 1}
                              </span>
                              <p className="mt-1.5 text-[11px] font-bold text-ink">
                                {step.title}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">
                                {step.text}
                              </p>
                            </li>
                          ))}
                        </ol>
                        <p className="text-xs font-semibold text-ink">
                          Los geht&apos;s: Womit soll dein Video starten?
                        </p>
                      </>
                    ) : (
                      <div className="text-center">
                        <h2 className="text-base font-bold text-ink">
                          Neue Szene
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                          Beim Aufnehmen springst du live zwischen deinen
                          Szenen, wie zwischen Browser-Tabs.
                        </p>
                      </div>
                    )}

                    {/* Fehler VOR den Kacheln: unterhalb wären sie außerhalb
                        des sichtbaren Bereichs und der Nutzer sähe „nichts". */}
                    {(pdfError || mediaError || canvaError) && (
                      <p
                        ref={uploadErrorRef}
                        className="flex w-full items-start gap-1.5 rounded-squircle-sm bg-danger-soft px-3 py-2 text-[11px] text-danger"
                      >
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        {pdfError || mediaError || canvaError}
                      </p>
                    )}

                    <section className="w-full">
                      <div className="mb-1.5 flex items-center gap-1.5 px-1">
                        <Sparkles className="size-3.5 text-brand-deep" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-brand-deep">
                          Pro Lead personalisiert
                        </h3>
                      </div>
                      <p className="mb-2 px-1 text-[10px] leading-snug text-ink-muted">
                        Passt sich automatisch an jeden Lead an.
                      </p>
                      <div className="grid w-full grid-cols-2 gap-2.5">
                        {PERSONALIZED_TILES.map((tile) =>
                          renderAddTile(tile, true),
                        )}
                      </div>
                    </section>

                    <section className="w-full">
                      <div className="mb-1.5 px-1">
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                          Für alle gleich
                        </h3>
                      </div>
                      <p className="mb-2 px-1 text-[10px] leading-snug text-ink-muted">
                        In jedem Video identisch.
                      </p>
                      <div className="grid w-full grid-cols-2 gap-2.5">
                        {STATIC_TILES.map((tile) =>
                          renderAddTile(tile, false),
                        )}
                      </div>
                    </section>

                      </>
                    )}

                    {/* Fokussierte Formular-Ansicht: Kacheln ausgeblendet,
                        damit die Eingabe nicht übersehen wird. */}
                    {addForm && activeTile && (
                      <>
                      <div className="w-full">
                        <button
                          type="button"
                          onClick={() => {
                            setAddForm(null);
                            setAddFormError(null);
                          }}
                          className="flex items-center gap-1 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
                        >
                          <ChevronLeft className="size-3.5" />
                          Zurück zur Auswahl
                        </button>
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <span className="flex size-10 items-center justify-center rounded-squircle-md bg-brand/15 text-brand-deep">
                          {activeTile.icon}
                        </span>
                        <h2 className="mt-2 text-base font-bold text-ink">
                          {activeTile.label}
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                          {activeTile.hint}
                        </p>
                      </div>
                      <form
                        className="flex w-full flex-col gap-2 rounded-squircle-md border border-brand/40 bg-surface p-4 shadow-card"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitAddForm();
                        }}
                      >
                        {addForm === "website" && hasRecipientWebsite && (
                          <>
                            <label className="text-[11px] font-semibold text-ink">
                              Welche Seite des Leads?
                            </label>
                            <input
                              autoFocus
                              type="text"
                              value={addPageName}
                              onChange={(e) => {
                                setAddPageName(e.target.value);
                                setAddFormError(null);
                              }}
                              placeholder="z. B. Karriereseite"
                              className="h-9 rounded-squircle-sm border border-line-soft bg-surface px-3 text-xs text-ink outline-none focus:border-brand"
                            />
                            <p className="text-[10px] leading-snug text-ink-muted">
                              Du zeigst schon die Website des Leads. Für diese
                              weitere Seite ordnest du beim Versand eine
                              eigene Spalte deiner Liste zu.
                            </p>
                          </>
                        )}
                        <label className="text-[11px] font-semibold text-ink">
                          {addForm === "gdocs"
                            ? "Link zum Google-Dokument"
                            : addForm === "gslide"
                              ? "Link zur veröffentlichten Präsentation"
                              : "Website-Adresse"}
                        </label>
                        <input
                          autoFocus={
                            !(addForm === "website" && hasRecipientWebsite)
                          }
                          type="text"
                          value={addUrl}
                          onChange={(e) => {
                            setAddUrl(e.target.value);
                            setAddFormError(null);
                          }}
                          placeholder={
                            addForm === "gdocs"
                              ? "https://docs.google.com/document/d/…"
                              : addForm === "gslide"
                                ? "https://docs.google.com/presentation/d/e/…/pub"
                                : addForm === "ownsite"
                                  ? "z. B. deine-firma.de"
                                  : "z. B. beispiel-firma.de"
                          }
                          className="h-9 rounded-squircle-sm border border-line-soft bg-surface px-3 text-xs text-ink outline-none focus:border-brand"
                        />
                        {addFormError && (
                          <p className="flex items-start gap-1.5 rounded-squircle-sm bg-danger-soft px-3 py-2 text-[11px] text-danger">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                            {addFormError}
                          </p>
                        )}
                        {addForm === "website" && (
                          <p className="text-[10px] leading-snug text-ink-muted">
                            Diese Adresse ist nur für deine Vorschau. Im
                            fertigen Video sieht jeder Lead seine eigene
                            Website.
                          </p>
                        )}
                        {addForm === "gdocs" && (
                          <p className="text-[10px] leading-snug text-ink-muted">
                            Die Vorschau zeigt deine Vorlage mit sichtbaren{" "}
                            <code className="rounded bg-surface-muted px-1">
                              {"{{platzhaltern}}"}
                            </code>
                            . Im fertigen Video werden sie pro Lead ersetzt.
                          </p>
                        )}
                        {addForm === "gslide" && (
                          <p className="text-[10px] leading-snug text-ink-muted">
                            So kommst du an den Link: In Google Slides auf
                            „Datei“ → „Freigeben“ → „Im Web veröffentlichen“.
                            Jede Folie wird eine eigene Szene. Platzhalter wie{" "}
                            <code className="rounded bg-surface-muted px-1">
                              {"{{firma}}"}
                            </code>{" "}
                            werden pro Lead ersetzt.
                          </p>
                        )}
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={gslideImporting}
                            onClick={() => setAddForm(null)}
                          >
                            Abbrechen
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!addUrl.trim() || gslideImporting}
                            iconLeft={
                              gslideImporting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : undefined
                            }
                          >
                            {gslideImporting
                              ? "Folien werden geladen…"
                              : "Hinzufügen"}
                          </Button>
                        </div>
                        {addForm === "gslide" && gslideImporting && (
                          <p className="text-[10px] leading-snug text-ink-muted">
                            Das kann bis zu einer Minute dauern, bitte lass
                            das Fenster offen.
                          </p>
                        )}
                      </form>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 bg-black">
                  {selected && (
                    <StudioStage
                      key={selected.id}
                      segment={selected.segment}
                      scrollRatio={
                        previewRatioRef.current.get(selected.id) ?? 0
                      }
                      onScrollRatio={(y) => {
                        previewRatioRef.current.set(selected.id, clamp01(y));
                        forceRender();
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Verstecktes PDF-Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onPdfFile(f);
            }}
          />

          {/* Verstecktes PPTX-Input (Canva/PowerPoint) */}
          <input
            ref={canvaInputRef}
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onCanvaFile(f);
            }}
          />

          {/* Verstecktes Bild-/Video-Input (accept wird per Klick gesetzt) */}
          <input
            ref={mediaInputRef}
            type="file"
            accept={STUDIO_MEDIA_ACCEPT.image}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onMediaFile(f);
            }}
          />

          {/* Detailkarten unter dem Fenster */}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {selected && !showNewTabPage && (
                <>
                  <div className="flex items-center gap-2 px-1">
                    <span className="min-w-0 truncate text-xs font-semibold text-ink">
                      Szene {selectedGroupIndex + 1} von {groups.length}:{" "}
                      {selectedGroup?.deckKey
                        ? `${deckLabel(selectedGroup)} – Folie ${
                            selectedSlideIndex + 1
                          } von ${selectedGroup.tabs.length}`
                        : tabLabel(selected)}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {selectedGroup?.deckKey ? (
                        <>
                          <button
                            type="button"
                            aria-label="Vorherige Folie"
                            disabled={selectedSlideIndex <= 0}
                            onClick={() =>
                              setSelectedId(
                                selectedGroup.tabs[selectedSlideIndex - 1].id,
                              )
                            }
                            className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronLeft className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Nächste Folie"
                            disabled={
                              selectedSlideIndex >=
                              selectedGroup.tabs.length - 1
                            }
                            onClick={() =>
                              setSelectedId(
                                selectedGroup.tabs[selectedSlideIndex + 1].id,
                              )
                            }
                            className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label="Nach vorn"
                            disabled={selectedGroupIndex <= 0}
                            onClick={() => onMoveTab(selected.id, -1)}
                            className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronLeft className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Nach hinten"
                            disabled={selectedGroupIndex >= groups.length - 1}
                            onClick={() => onMoveTab(selected.id, 1)}
                            className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        aria-label={
                          selectedGroup?.deckKey
                            ? "Folie löschen"
                            : "Szene löschen"
                        }
                        onClick={() => onRemoveTab(selected.id)}
                        className="rounded-full p-1 text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                  <SceneSettings
                    tab={selected}
                    status={assets.statusById[selected.id] ?? "loading"}
                    error={assets.errorById[selected.id]}
                    onRetry={() => assets.retry(selected.id)}
                    updateSegment={updateSegment}
                  />
                </>
              )}
            </div>

            {/* Teleprompter (opt-in, Toggle sitzt im Kopf neben Abbrechen) */}
            {prompterOpen && (
              <section className="w-[300px] shrink-0 rounded-squircle-lg bg-surface p-3 shadow-card">
                <div className="mb-1 flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Teleprompter (optional)
                  </h2>
                  <button
                    type="button"
                    onClick={() => setPrompterOpen(false)}
                    className="text-[10px] font-medium text-ink-muted/70 transition-colors hover:text-ink-muted"
                  >
                    Ausblenden
                  </button>
                </div>
                <textarea
                  value={script}
                  onChange={(e) => onScriptChange(e.target.value)}
                  rows={3}
                  placeholder="Hallo, ich habe mir eure Website angeschaut und…"
                  className="w-full resize-y rounded-squircle-sm border border-line-soft bg-surface-soft p-2.5 text-xs leading-relaxed text-ink outline-none focus:border-brand"
                />
                <p className="px-1 text-[10px] leading-snug text-ink-muted">
                  Läuft während der Aufnahme dezent oben mit.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Fußzeile */}
      <footer className="flex items-center justify-between border-t border-line-soft bg-surface/60 px-6 py-3 backdrop-blur">
        <p className="text-xs text-ink-muted">
          {tabs.length === 0
            ? "Mindestens eine Szene wird benötigt."
            : assets.allReady
              ? "Alle Szenen sind bereit."
              : "Szenen werden vorbereitet…"}
        </p>
        <span title={continueTitle}>
          <Button
            onClick={onNext}
            disabled={!canContinue}
            iconRight={<ArrowRight className="size-4" />}
          >
            Weiter
          </Button>
        </span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Szenen-Einstellungen                                                */
/* ------------------------------------------------------------------ */

function SceneSettings({
  tab,
  status,
  error,
  onRetry,
  updateSegment,
}: {
  tab: StudioTab;
  status: "loading" | "ready" | "error";
  error?: string;
  onRetry: () => void;
  updateSegment: UpdateSegmentFn;
}) {
  const seg = tab.segment;

  if (status === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error
            ? friendlyScreenshotError(error)
            : "Die Vorschau konnte nicht erstellt werden."}
        </p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Erneut versuchen
        </Button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-squircle-lg bg-surface px-3 py-2.5 shadow-card">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-muted" />
        <p className="text-[11px] text-ink-muted">
          Die Vorschau wird vorbereitet…
        </p>
      </div>
    );
  }

  if (seg.kind === "text") {
    return (
      <div className="flex items-start gap-4 rounded-squircle-lg bg-surface p-3 shadow-card">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-[11px] font-semibold text-ink">
            Text der Folie
          </label>
          <textarea
            value={seg.text}
            onChange={(e) =>
              updateSegment(tab.id, (s) =>
                s.kind === "text"
                  ? ({ ...s, text: e.target.value } satisfies TextSegment)
                  : s,
              )
            }
            rows={2}
            className="w-full resize-y rounded-squircle-sm border border-line-soft bg-surface-soft p-2 text-xs text-ink outline-none focus:border-brand"
          />
        </div>
        <div className="flex shrink-0 gap-3 pt-1">
          <label className="flex flex-col items-center gap-1 text-[10px] font-medium text-ink-muted">
            Hintergrund
            <input
              type="color"
              value={seg.bgColor}
              onChange={(e) =>
                updateSegment(tab.id, (s) =>
                  s.kind === "text" ? { ...s, bgColor: e.target.value } : s,
                )
              }
              className="size-8 cursor-pointer rounded border border-line-soft bg-transparent"
            />
          </label>
          <label className="flex flex-col items-center gap-1 text-[10px] font-medium text-ink-muted">
            Textfarbe
            <input
              type="color"
              value={seg.textColor}
              onChange={(e) =>
                updateSegment(tab.id, (s) =>
                  s.kind === "text" ? { ...s, textColor: e.target.value } : s,
                )
              }
              className="size-8 cursor-pointer rounded border border-line-soft bg-transparent"
            />
          </label>
        </div>
      </div>
    );
  }

  if (seg.kind === "gdocs") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Die Vorschau zeigt deine Vorlage mit sichtbaren{" "}
          <code className="rounded bg-surface-muted px-1">
            {"{{platzhaltern}}"}
          </code>
          . Im fertigen Video werden sie pro Lead ersetzt. Scroll ruhig,
          genau so sieht es später aus — am besten möglichst langsam, dann
          wirkt das Video schön flüssig.
        </p>
      </div>
    );
  }

  if (seg.kind === "gslide") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Folie {seg.slideIndex + 1} deiner Präsentation.{" "}
          {seg.detectedPlaceholders.length > 0 ? (
            <>
              Platzhalter auf dieser Folie (werden pro Lead ersetzt):{" "}
              {seg.detectedPlaceholders.map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && ", "}
                  <code className="rounded bg-surface-muted px-1">
                    {`{{${p}}}`}
                  </code>
                </React.Fragment>
              ))}
            </>
          ) : (
            <>
              Platzhalter wie{" "}
              <code className="rounded bg-surface-muted px-1">
                {"{{firma}}"}
              </code>{" "}
              würden pro Lead ersetzt, auf dieser Folie wurden keine
              gefunden.
            </>
          )}
        </p>
      </div>
    );
  }

  if (seg.kind === "canva") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Folie {seg.slideIndex + 1}
          {seg.fileName ? ` von ${seg.fileName}` : ""}.{" "}
          {seg.detectedPlaceholders.length > 0 ? (
            <>
              Platzhalter auf dieser Folie (werden pro Lead ersetzt):{" "}
              {seg.detectedPlaceholders.map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && ", "}
                  <code className="rounded bg-surface-muted px-1">
                    {`{{${p}}}`}
                  </code>
                </React.Fragment>
              ))}
            </>
          ) : (
            <>
              Platzhalter wie{" "}
              <code className="rounded bg-surface-muted px-1">
                {"{{firma}}"}
              </code>{" "}
              würden pro Lead ersetzt, auf dieser Folie wurden keine
              gefunden.
            </>
          )}
        </p>
      </div>
    );
  }

  if (seg.kind === "website") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        {seg.personalized === false ? (
          <p className="truncate text-[11px] text-ink-muted">
            Feste Webseite:{" "}
            <span className="font-medium text-ink">{seg.fallbackUrl}</span>.
            In jedem Video gleich.
          </p>
        ) : seg.urlColumn ? (
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Zeigt pro Lead die Seite{" "}
            <span className="font-medium text-ink">
              {seg.label || seg.urlColumn}
            </span>
            . Beim Versand ordnest du dafür eine Spalte deiner Liste zu.
            Vorschau-Quelle:{" "}
            <span className="font-medium text-ink">{seg.fallbackUrl}</span>
          </p>
        ) : (
          <p className="truncate text-[11px] text-ink-muted">
            Vorschau-Quelle:{" "}
            <span className="font-medium text-ink">{seg.fallbackUrl}</span>.
            Im fertigen Video sieht jeder Lead seine eigene Website.
          </p>
        )}
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
          Gut zu wissen: In der Vorschau können einzelne Elemente der Webseite
          fehlen — im fertigen Video sind sie zu sehen. Und scroll möglichst
          langsam, dann wirkt das Video später schön flüssig.
        </p>
      </div>
    );
  }

  if (seg.kind === "pdf") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          {seg.fileName || "PDF"} · {seg.pageCount}{" "}
          {seg.pageCount === 1 ? "Seite" : "Seiten"}. Scrolle in der Vorschau,
          um durch das Dokument zu blättern — am besten möglichst langsam,
          dann wirkt das Video schön flüssig.
        </p>
      </div>
    );
  }

  if (seg.kind === "image") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Das Bild ist in jedem Video gleich, genau wie hier in der Vorschau.
        </p>
      </div>
    );
  }

  if (seg.kind === "video") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Das Video startest du während der Aufnahme per Klick auf Play, der
          Ton läuft mit. Bis dahin steht es als Standbild.
        </p>
      </div>
    );
  }

  return null;
}
