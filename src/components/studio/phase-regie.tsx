"use client";

/**
 * phase-regie — Phase 1 des Studio-Flows: Szenen anlegen, sortieren und
 * vorbereiten lassen.
 *
 * Die Bühne ist ein Browser-Fenster: Szenen liegen als Tabs in der
 * Chrome-Leiste, ein „+"-Tab öffnet die Neuer-Tab-Seite zum Hinzufügen
 * (Website / Google Docs / PDF / Text-Folie). Darunter: Einstellungen der
 * gewählten Szene + Teleprompter.
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
  Loader2,
  Plus,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StudioTab } from "@/lib/studio/types";
import type { PdfSegment, Segment, TextSegment } from "@/lib/segments/types";
import {
  createGDocsSegment,
  createPdfSegment,
  createTextSegment,
  createWebsiteSegment,
} from "@/lib/segments/defaults";
import { StudioStage } from "./studio-stage";
import { SceneKindIcon } from "./scene-icon";
import { StudioWordmark } from "./studio-wordmark";
import {
  clamp01,
  sceneKindOf,
  tabLabel,
  tabThumbUrl,
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

/** URL normalisieren: https:// voranstellen, wenn kein Protokoll da ist. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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

const ADD_TILES: {
  kind: StudioSceneKind;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    kind: "website",
    label: "Website",
    hint: "z. B. die Website deines Empfängers",
    icon: <Globe className="size-4" />,
  },
  {
    kind: "gdocs",
    label: "Google Docs",
    hint: "Dokument-Vorlage mit Platzhaltern",
    icon: <FileText className="size-4" />,
  },
  {
    kind: "pdf",
    label: "PDF",
    hint: "Eigenes PDF hochladen",
    icon: <FileType2 className="size-4" />,
  },
  {
    kind: "text",
    label: "Text-Folie",
    hint: "Kurzer Text als Standbild",
    icon: <Type className="size-4" />,
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
  /** Offenes URL-Eingabe-Formular (website/gdocs) auf der Neuer-Tab-Seite. */
  const [addForm, setAddForm] = React.useState<"website" | "gdocs" | null>(
    null,
  );
  const [addUrl, setAddUrl] = React.useState("");
  const [pdfUploading, setPdfUploading] = React.useState(false);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  /** Vorschau-Scrollposition pro Szene (nur für die Regie-Vorschau). */
  const previewRatioRef = React.useRef<Map<string, number>>(new Map());
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  // Auswahl reparieren, wenn die gewählte Szene gelöscht wurde.
  React.useEffect(() => {
    if (selectedId && tabs.some((t) => t.id === selectedId)) return;
    setSelectedId(tabs[0]?.id ?? null);
  }, [tabs, selectedId]);

  const selected = tabs.find((t) => t.id === selectedId) ?? null;

  const addScene = (segment: Segment) => {
    onAddTab(segment);
    // Die neue Szene bekommt eine neue Tab-ID im Flow — Auswahl folgt via
    // Effekt, sobald tabs aktualisiert sind (letzte Szene selektieren).
  };

  // Neu hinzugefügte Szene automatisch auswählen + Neuer-Tab-Seite schließen.
  const prevCountRef = React.useRef(tabs.length);
  React.useEffect(() => {
    if (tabs.length > prevCountRef.current) {
      setSelectedId(tabs[tabs.length - 1].id);
      setAdding(false);
    }
    prevCountRef.current = tabs.length;
  }, [tabs]);

  const submitAddForm = () => {
    const url = normalizeUrl(addUrl);
    if (!url || !addForm) return;
    if (addForm === "website") {
      const seg = createWebsiteSegment({ label: hostLabel(url) });
      seg.fallbackUrl = url;
      addScene(seg);
    } else {
      const seg = createGDocsSegment({ label: "Google Docs" });
      seg.docsUrl = url;
      addScene(seg);
    }
    setAddUrl("");
    setAddForm(null);
  };

  const onTileClick = (kind: StudioSceneKind) => {
    setPdfError(null);
    if (kind === "text") {
      addScene(createTextSegment({ label: "Text-Folie" }));
      return;
    }
    if (kind === "pdf") {
      fileInputRef.current?.click();
      return;
    }
    setAddForm((prev) => (prev === kind ? null : kind));
    setAddUrl("");
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

  const canContinue = tabs.length > 0 && assets.allReady;
  const continueTitle = canContinue
    ? undefined
    : tabs.length === 0
      ? "Füge zuerst mindestens eine Szene hinzu."
      : "Bitte warte, bis alle Szenen vorbereitet sind.";

  const showNewTabPage = adding || !selected;
  const selectedIndex = selected
    ? tabs.findIndex((t) => t.id === selected.id)
    : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Kopfzeile */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-3">
          <StudioWordmark />
          <span className="text-sm font-medium text-ink-muted">Regie</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink"
        >
          <X className="size-3.5" />
          Abbrechen
        </button>
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
                {tabs.map((tab, i) => {
                  const status = assets.statusById[tab.id] ?? "loading";
                  const active = !showNewTabPage && tab.id === selectedId;
                  const thumb = tabThumbUrl(tab);
                  return (
                    <div
                      key={tab.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setAdding(false);
                        setSelectedId(tab.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setAdding(false);
                          setSelectedId(tab.id);
                        }
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
                        {i + 1}
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
                        {tabLabel(tab)}
                      </span>
                      {status === "loading" && (
                        <Loader2 className="size-3 shrink-0 animate-spin text-ink-muted" />
                      )}
                      {status === "error" && (
                        <AlertCircle className="size-3 shrink-0 text-danger" />
                      )}
                      <button
                        type="button"
                        aria-label="Szene löschen"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTab(tab.id);
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
                  <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-5 px-6 py-8">
                    <div className="text-center">
                      <h2 className="text-base font-bold text-ink">
                        Neue Szene
                      </h2>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        Während der Aufnahme wechselst du live zwischen deinen
                        Szenen — wie zwischen Browser-Tabs.
                      </p>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2.5">
                      {ADD_TILES.map((tile) => (
                        <button
                          key={tile.kind}
                          type="button"
                          onClick={() => onTileClick(tile.kind)}
                          disabled={tile.kind === "pdf" && pdfUploading}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-squircle-md border p-3 text-left transition-colors",
                            addForm === tile.kind
                              ? "border-brand bg-brand-soft"
                              : "border-line-soft bg-surface-soft hover:border-line hover:bg-surface-muted",
                            tile.kind === "pdf" && pdfUploading && "opacity-60",
                          )}
                        >
                          <span className="flex w-full items-center gap-1.5 text-xs font-bold text-ink">
                            {tile.kind === "pdf" && pdfUploading ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              tile.icon
                            )}
                            {tile.label}
                            <Plus className="ml-auto size-3 text-ink-muted" />
                          </span>
                          <span className="text-[10px] leading-snug text-ink-muted">
                            {tile.kind === "pdf" && pdfUploading
                              ? "Wird hochgeladen…"
                              : tile.hint}
                          </span>
                        </button>
                      ))}
                    </div>

                    {pdfError && (
                      <p className="flex w-full items-start gap-1.5 rounded-squircle-sm bg-danger-soft px-3 py-2 text-[11px] text-danger">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        {pdfError}
                      </p>
                    )}

                    {/* URL-Formular für Website / Google Docs */}
                    {addForm && (
                      <form
                        className="flex w-full flex-col gap-2 rounded-squircle-md border border-line-soft bg-surface-soft p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitAddForm();
                        }}
                      >
                        <label className="text-[11px] font-semibold text-ink">
                          {addForm === "website"
                            ? "Website-Adresse"
                            : "Link zum Google-Dokument"}
                        </label>
                        <input
                          autoFocus
                          type="text"
                          value={addUrl}
                          onChange={(e) => setAddUrl(e.target.value)}
                          placeholder={
                            addForm === "website"
                              ? "z. B. beispiel-firma.de"
                              : "https://docs.google.com/document/d/…"
                          }
                          className="h-9 rounded-squircle-sm border border-line-soft bg-surface px-3 text-xs text-ink outline-none focus:border-brand"
                        />
                        {addForm === "gdocs" && (
                          <p className="text-[10px] leading-snug text-ink-muted">
                            Die Vorschau zeigt deine Vorlage mit sichtbaren{" "}
                            <code className="rounded bg-surface-muted px-1">
                              {"{{platzhaltern}}"}
                            </code>{" "}
                            — im fertigen Video werden sie pro Empfänger
                            ersetzt.
                          </p>
                        )}
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setAddForm(null)}
                          >
                            Abbrechen
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!addUrl.trim()}
                          >
                            Hinzufügen
                          </Button>
                        </div>
                      </form>
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

          {/* Detailkarten unter dem Fenster */}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {selected && !showNewTabPage && (
                <>
                  <div className="flex items-center gap-2 px-1">
                    <span className="min-w-0 truncate text-xs font-semibold text-ink">
                      Szene {selectedIndex + 1} von {tabs.length}:{" "}
                      {tabLabel(selected)}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Nach vorn"
                        disabled={selectedIndex <= 0}
                        onClick={() => onMoveTab(selected.id, -1)}
                        className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Nach hinten"
                        disabled={selectedIndex >= tabs.length - 1}
                        onClick={() => onMoveTab(selected.id, 1)}
                        className="rounded-full p-1 text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink disabled:opacity-30"
                      >
                        <ChevronRight className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Szene löschen"
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

            {/* Teleprompter */}
            <section className="w-[300px] shrink-0 rounded-squircle-lg bg-surface p-3 shadow-card">
              <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
                Teleprompter (optional)
              </h2>
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
          {error ?? "Die Vorschau konnte nicht erstellt werden."}
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
          . Im fertigen Video wird das Dokument pro Empfänger personalisiert.
          Du kannst in der Vorschau scrollen — genau so sieht es später aus.
        </p>
      </div>
    );
  }

  if (seg.kind === "website") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="truncate text-[11px] text-ink-muted">
          Vorschau-Quelle:{" "}
          <span className="font-medium text-ink">{seg.fallbackUrl}</span> — in
          der Kampagne wird pro Empfänger dessen Website gezeigt.
        </p>
      </div>
    );
  }

  if (seg.kind === "pdf") {
    return (
      <div className="rounded-squircle-lg bg-surface p-3 shadow-card">
        <p className="truncate text-[11px] text-ink-muted">
          {seg.fileName || "PDF"} · {seg.pageCount}{" "}
          {seg.pageCount === 1 ? "Seite" : "Seiten"} — scrolle in der Vorschau,
          um durch das Dokument zu blättern.
        </p>
      </div>
    );
  }

  return null;
}
