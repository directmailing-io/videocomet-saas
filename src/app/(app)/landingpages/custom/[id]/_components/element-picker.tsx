"use client";

/**
 * Visueller Element-Picker für Custom-Landingpages.
 *
 * Workflow (Wizard-Schritt 2 nach erfolgreichem ZIP-Upload):
 *   1. Parent reicht uns das *rohe* `index.html` der gerade hochgeladenen
 *      Version (oder eine Bunny-URL). Wir POSTen es an `/api/custom-lp/preview`
 *      → bekommen ein gerendertes, mit Inspector-Skript injiziertes HTML.
 *   2. Wir laden das HTML in einen <iframe srcDoc>.
 *   3. Iframe sendet bei jedem Klick `{type: "vc-element-picked", selector, text, tag}`
 *      via postMessage. Wir zeigen ein Side-Panel "Diesem Element zuweisen
 *      als…" mit Buttons [Video / Primary CTA / Secondary CTA / Sektion tracken].
 *   4. Annotations werden im lokalen State gepflegt und an Parent gepusht
 *      (controlled). Parent speichert sie beim Bestätigen via
 *      POST /versions oder PATCH /versions/[vid].
 *
 * Power-User können "Ohne Element-Picker fortfahren" wählen — dann werden
 * keine Annotations gesetzt und das Tracking nutzt nur eingebaute
 * `data-vc-*` Attribute aus dem HTML.
 *
 * Robustheit:
 *   - Inspector-Toggle wird per postMessage gesteuert (an / aus)
 *   - Bei jeder neuen Auswahl wird die vorherige im Panel angezeigt → Kunde
 *     kann das Element "zuweisen" oder verwerfen
 *   - Initiale `annotations` werden in Tags neben dem Iframe gezeigt
 */

import * as React from "react";
import {
  Eye,
  EyeOff,
  Video,
  MousePointerClick,
  Layers,
  Trash2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ElementAnnotations {
  videoSelector: string | null;
  primaryCta: string | null;
  secondaryCta: string | null;
  sections: string[];
}

export const EMPTY_ANNOTATIONS: ElementAnnotations = {
  videoSelector: null,
  primaryCta: null,
  secondaryCta: null,
  sections: [],
};

interface ElementPickerProps {
  /** Roh-HTML der gerade aktiven / hochgeladenen Version. */
  html: string;
  /** Demo-Lead-Daten für die Placeholder-Ersetzung in der Vorschau. */
  leadData?: Record<string, string>;
  value: ElementAnnotations;
  onChange: (next: ElementAnnotations) => void;
  /** Wird gerufen, wenn der Kunde "Übernehmen" klickt. Parent speichert. */
  onCommit: (annotations: ElementAnnotations) => void;
  /** Wird gerufen, wenn der Kunde "Ohne Picker fortfahren" wählt. */
  onSkip: () => void;
}

interface PickedTarget {
  selector: string;
  text: string;
  tag: string;
}

type AssignKind = "video" | "primary" | "secondary" | "section";

export function ElementPicker({
  html,
  leadData,
  value,
  onChange,
  onCommit,
  onSkip,
}: ElementPickerProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewReady, setPreviewReady] = React.useState(false);
  const [inspectorOn, setInspectorOn] = React.useState(true);
  const [picked, setPicked] = React.useState<PickedTarget | null>(null);

  // ── 1. Roh-HTML → /api/custom-lp/preview → injizierte Vorschau ───────────
  React.useEffect(() => {
    let cancelled = false;
    setPreviewHtml(null);
    setPreviewError(null);
    setPreviewReady(false);
    (async () => {
      try {
        const res = await fetch("/api/custom-lp/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            html,
            leadData: leadData ?? {},
            withInspector: true,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          rewrittenHtml?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.rewrittenHtml) {
          setPreviewError(data.error ?? "Vorschau konnte nicht erzeugt werden.");
          return;
        }
        setPreviewHtml(data.rewrittenHtml);
      } catch {
        if (!cancelled) {
          setPreviewError("Verbindungsfehler bei der Vorschau.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, leadData]);

  // ── 2. postMessage-Listener (iframe → parent) ────────────────────────────
  React.useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== "object") return;
      const d = ev.data as {
        type?: string;
        selector?: string;
        text?: string;
        tag?: string;
      };
      if (d.type === "vc-inspector-ready") {
        setPreviewReady(true);
        // Inspector erstmal aktivieren
        sendToggle(true);
        return;
      }
      if (d.type === "vc-element-picked" && d.selector) {
        setPicked({
          selector: d.selector,
          text: d.text ?? "",
          tag: d.tag ?? "div",
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ── 3. Inspector-Toggle an iframe pushen ─────────────────────────────────
  const sendToggle = React.useCallback((enabled: boolean) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "vc-inspector-toggle", enabled }, "*");
  }, []);

  React.useEffect(() => {
    if (previewReady) sendToggle(inspectorOn);
  }, [inspectorOn, previewReady, sendToggle]);

  // ── 4. Zuweisungs-Logik ──────────────────────────────────────────────────
  function assign(kind: AssignKind) {
    if (!picked) return;
    const sel = picked.selector;
    if (kind === "video") {
      onChange({ ...value, videoSelector: sel });
    } else if (kind === "primary") {
      onChange({ ...value, primaryCta: sel });
    } else if (kind === "secondary") {
      onChange({ ...value, secondaryCta: sel });
    } else if (kind === "section") {
      if (!value.sections.includes(sel)) {
        onChange({ ...value, sections: [...value.sections, sel] });
      }
    }
    setPicked(null);
  }

  function clearAssignment(kind: AssignKind, idx?: number) {
    if (kind === "video") onChange({ ...value, videoSelector: null });
    else if (kind === "primary") onChange({ ...value, primaryCta: null });
    else if (kind === "secondary") onChange({ ...value, secondaryCta: null });
    else if (kind === "section" && typeof idx === "number") {
      onChange({
        ...value,
        sections: value.sections.filter((_, i) => i !== idx),
      });
    }
  }

  const hasAnnotations =
    Boolean(value.videoSelector) ||
    Boolean(value.primaryCta) ||
    Boolean(value.secondaryCta) ||
    value.sections.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
      {/* ── Iframe-Vorschau ────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="size-4 text-brand-deep shrink-0" />
              <p className="text-sm font-semibold text-ink truncate">
                Live-Vorschau
              </p>
              <Badge variant={inspectorOn ? "brand" : "neutral"} dot>
                {inspectorOn ? "Picker aktiv" : "Picker aus"}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInspectorOn((v) => !v)}
              iconLeft={
                inspectorOn ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )
              }
            >
              {inspectorOn ? "Picker pausieren" : "Picker aktivieren"}
            </Button>
          </div>

          <div className="relative bg-surface-muted">
            {previewError && (
              <div className="p-6 text-center text-sm text-danger">
                {previewError}
              </div>
            )}
            {!previewError && previewHtml === null && (
              <div className="p-12 text-center text-sm text-ink-muted">
                Vorschau wird vorbereitet …
              </div>
            )}
            {previewHtml !== null && (
              <iframe
                ref={iframeRef}
                title="Vorschau"
                // sandbox erlaubt scripts (für unseren Inspector + User-JS) aber
                // keine Top-Navigation oder Form-Submits. KEIN allow-same-origin
                // → User-Scripts können nicht auf die echte Origin zugreifen.
                sandbox="allow-scripts"
                srcDoc={previewHtml}
                className="w-full h-[640px] bg-white"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Side-Panel ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Aktuell gepicktes Element */}
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Aktuelle Auswahl
            </p>
            {picked ? (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="brand">{picked.tag}</Badge>
                  {picked.text && (
                    <span className="text-xs text-ink-muted truncate">
                      &laquo;{picked.text}&raquo;
                    </span>
                  )}
                </div>
                <code className="block text-[11px] font-mono text-ink bg-surface-muted rounded-squircle-sm p-2 break-all">
                  {picked.selector}
                </code>

                <p className="text-xs text-ink-muted mt-3 mb-2">
                  Diesem Element zuweisen als …
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => assign("video")}
                    iconLeft={<Video className="size-4" />}
                    className="justify-start"
                  >
                    Video
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => assign("primary")}
                    iconLeft={<MousePointerClick className="size-4" />}
                    className="justify-start"
                  >
                    Primärer CTA
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => assign("secondary")}
                    iconLeft={<MousePointerClick className="size-4" />}
                    className="justify-start"
                  >
                    Sekundärer CTA
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => assign("section")}
                    iconLeft={<Layers className="size-4" />}
                    className="justify-start"
                  >
                    Sektion tracken
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPicked(null)}
                  className="w-full mt-2 text-ink-muted"
                >
                  Verwerfen
                </Button>
              </div>
            ) : (
              <p className="text-xs text-ink-muted leading-relaxed">
                Klicken Sie in der Vorschau auf ein Element (Video, Button oder
                Section), um es einer Rolle zuzuweisen.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Zugewiesene Annotations */}
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
              Zugewiesene Rollen
            </p>
            <div className="space-y-2.5 text-xs">
              <AssignmentRow
                icon={<Video className="size-3.5" />}
                label="Video"
                selector={value.videoSelector}
                onClear={() => clearAssignment("video")}
              />
              <AssignmentRow
                icon={<MousePointerClick className="size-3.5" />}
                label="Primärer CTA"
                selector={value.primaryCta}
                onClear={() => clearAssignment("primary")}
              />
              <AssignmentRow
                icon={<MousePointerClick className="size-3.5" />}
                label="Sekundärer CTA"
                selector={value.secondaryCta}
                onClear={() => clearAssignment("secondary")}
              />
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Layers className="size-3.5 text-ink-muted" />
                  <p className="font-semibold text-ink">Sektionen</p>
                </div>
                {value.sections.length === 0 ? (
                  <p className="text-ink-muted text-[11px] pl-5">
                    Noch keine.
                  </p>
                ) : (
                  <ul className="space-y-1 pl-5">
                    {value.sections.map((s, i) => (
                      <li
                        key={`${s}-${i}`}
                        className="flex items-center justify-between gap-1.5"
                      >
                        <code className="font-mono text-[10px] truncate text-ink">
                          {s}
                        </code>
                        <button
                          type="button"
                          onClick={() => clearAssignment("section", i)}
                          className="text-ink-muted hover:text-danger shrink-0"
                          aria-label={`Sektion ${s} entfernen`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => onCommit(value)}
            iconLeft={<CheckCircle2 className="size-4" />}
            disabled={!hasAnnotations}
          >
            Annotations übernehmen
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            Ohne Element-Picker fortfahren
          </Button>
          <p className="text-[11px] text-ink-muted leading-relaxed">
            Profi-Tipp: Sie können auch{" "}
            <code className="font-mono">data-vc-video</code>,{" "}
            <code className="font-mono">data-vc-cta="primary"</code> etc. direkt
            in Ihrem HTML setzen — dann erkennen wir die Elemente automatisch.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────

function AssignmentRow({
  icon,
  label,
  selector,
  onClear,
}: {
  icon: React.ReactNode;
  label: string;
  selector: string | null;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-ink-muted">{icon}</span>
        <p className="font-semibold text-ink">{label}</p>
        {selector && (
          <Badge variant="success" className="ml-auto">
            gesetzt
          </Badge>
        )}
      </div>
      {selector ? (
        <div className="flex items-center justify-between gap-2 pl-5">
          <code className="font-mono text-[10px] truncate text-ink">
            {selector}
          </code>
          <button
            type="button"
            onClick={onClear}
            className="text-ink-muted hover:text-danger shrink-0"
            aria-label={`${label} entfernen`}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ) : (
        <p
          className={cn(
            "text-ink-muted text-[11px] pl-5",
          )}
        >
          Noch nicht zugewiesen.
        </p>
      )}
    </div>
  );
}
