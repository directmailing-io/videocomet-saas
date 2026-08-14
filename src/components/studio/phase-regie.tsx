"use client";

/**
 * phase-regie — Phase 1 des Studio-Flows: Szenen anlegen, sortieren und
 * vorbereiten lassen.
 *
 * Links: Szenen-Liste (Status-Badges aus use-scene-assets) + 4 Typ-Kacheln
 * zum Hinzufügen + Teleprompter-Text. Rechts: große 16:9-Vorschau der
 * ausgewählten Szene (StudioStage, scrollbar) + Szenen-Einstellungen.
 *
 * „Weiter" ist erst aktiv, wenn ≥1 Szene existiert und ALLE bereit sind —
 * die Live-Aufnahme braucht keine Netzwerk-Ladevorgänge mehr.
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
import {
  clamp01,
  sceneKindOf,
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
  /** Offenes URL-Eingabe-Formular (website/gdocs) unter den Kacheln. */
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

  // Neu hinzugefügte Szene automatisch auswählen.
  const prevCountRef = React.useRef(tabs.length);
  React.useEffect(() => {
    if (tabs.length > prevCountRef.current) {
      setSelectedId(tabs[tabs.length - 1].id);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Kopfzeile */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div>
          <h1 className="text-sm font-bold text-white">
            Studio-Aufnahme · Regie
          </h1>
          <p className="text-xs text-white/50">
            Lege deine Szenen fest — während der Aufnahme wechselst du live
            zwischen ihnen.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
          Abbrechen
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Linke Spalte: Szenen + Hinzufügen + Teleprompter */}
        <div className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          {/* Szenen-Liste */}
          <section className="rounded-squircle-lg bg-surface p-3 shadow-card">
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Szenen ({tabs.length})
            </h2>
            {tabs.length === 0 ? (
              <p className="px-1 py-3 text-xs text-ink-muted">
                Noch keine Szenen. Füge unten deine erste Szene hinzu.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {tabs.map((tab, i) => {
                  const status = assets.statusById[tab.id] ?? "loading";
                  const active = tab.id === selectedId;
                  return (
                    <li key={tab.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(tab.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setSelectedId(tab.id);
                        }}
                        className={cn(
                          "group flex w-full cursor-pointer items-center gap-2 rounded-squircle-md border px-2.5 py-2 text-left transition-colors",
                          active
                            ? "border-brand bg-brand-soft"
                            : "border-transparent bg-surface-soft hover:bg-surface-muted",
                        )}
                      >
                        <span className="w-4 shrink-0 text-center text-xs font-bold text-ink-muted">
                          {i + 1}
                        </span>
                        <SceneKindIcon
                          kind={sceneKindOf(tab)}
                          className="shrink-0 text-brand-deep"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                          {tab.segment.label}
                        </span>

                        {/* Status-Badge */}
                        {status === "loading" && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-muted">
                            <Loader2 className="size-3 animate-spin" />
                            Wird vorbereitet…
                          </span>
                        )}
                        {status === "ready" && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ok">
                            <CheckCircle2 className="size-3" />
                            Bereit
                          </span>
                        )}
                        {status === "error" && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-danger">
                            <AlertCircle className="size-3" />
                            Fehler
                          </span>
                        )}

                        {/* Sortieren + Löschen */}
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            aria-label="Nach oben"
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveTab(tab.id, -1);
                            }}
                            className="rounded p-0.5 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Nach unten"
                            disabled={i === tabs.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveTab(tab.id, 1);
                            }}
                            className="rounded p-0.5 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Szene löschen"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveTab(tab.id);
                            }}
                            className="rounded p-0.5 text-ink-muted hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Szene hinzufügen */}
          <section className="rounded-squircle-lg bg-surface p-3 shadow-card">
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Szene hinzufügen
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {ADD_TILES.map((tile) => (
                <button
                  key={tile.kind}
                  type="button"
                  onClick={() => onTileClick(tile.kind)}
                  disabled={tile.kind === "pdf" && pdfUploading}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-squircle-md border p-2.5 text-left transition-colors",
                    addForm === tile.kind
                      ? "border-brand bg-brand-soft"
                      : "border-line-soft bg-surface-soft hover:bg-surface-muted",
                    tile.kind === "pdf" && pdfUploading && "opacity-60",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
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
            {pdfError && (
              <p className="mt-2 flex items-start gap-1.5 rounded-squircle-sm bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                {pdfError}
              </p>
            )}

            {/* URL-Formular für Website / Google Docs */}
            {addForm && (
              <form
                className="mt-2 flex flex-col gap-2 rounded-squircle-md bg-surface-soft p-2.5"
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
                  className="h-8 rounded-squircle-sm border border-line-soft bg-surface px-2.5 text-xs text-ink outline-none focus:border-brand"
                />
                {addForm === "gdocs" && (
                  <p className="text-[10px] leading-snug text-ink-muted">
                    Die Vorschau zeigt deine Vorlage mit sichtbaren{" "}
                    <code className="rounded bg-surface-muted px-1">
                      {"{{platzhaltern}}"}
                    </code>{" "}
                    — im fertigen Video werden sie pro Empfänger ersetzt.
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
                  <Button type="submit" size="sm" disabled={!addUrl.trim()}>
                    Hinzufügen
                  </Button>
                </div>
              </form>
            )}
          </section>

          {/* Teleprompter */}
          <section className="rounded-squircle-lg bg-surface p-3 shadow-card">
            <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Teleprompter (optional)
            </h2>
            <p className="mb-2 px-1 text-[10px] leading-snug text-ink-muted">
              Dein Skript läuft während der Aufnahme halbtransparent oben mit.
            </p>
            <textarea
              value={script}
              onChange={(e) => onScriptChange(e.target.value)}
              rows={4}
              placeholder="Hallo, ich habe mir eure Website angeschaut und…"
              className="w-full resize-y rounded-squircle-sm border border-line-soft bg-surface-soft p-2.5 text-xs leading-relaxed text-ink outline-none focus:border-brand"
            />
          </section>
        </div>

        {/* Rechte Spalte: Vorschau + Einstellungen */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative w-full overflow-hidden rounded-squircle-lg bg-black/40 shadow-card">
            <div className="relative aspect-video w-full">
              {selected ? (
                <StudioStage
                  key={selected.id}
                  segment={selected.segment}
                  scrollRatio={previewRatioRef.current.get(selected.id) ?? 0}
                  onScrollRatio={(y) => {
                    previewRatioRef.current.set(selected.id, clamp01(y));
                    forceRender();
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
                  <Plus className="size-8" />
                  <p className="text-sm">
                    Füge links deine erste Szene hinzu, um die Vorschau zu
                    sehen.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Einstellungen zur gewählten Szene */}
          {selected && (
            <SceneSettings
              tab={selected}
              status={assets.statusById[selected.id] ?? "loading"}
              error={assets.errorById[selected.id]}
              onRetry={() => assets.retry(selected.id)}
              updateSegment={updateSegment}
            />
          )}
        </div>
      </div>

      {/* Fußzeile */}
      <footer className="flex items-center justify-between border-t border-white/10 px-6 py-3">
        <p className="text-xs text-white/50">
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
