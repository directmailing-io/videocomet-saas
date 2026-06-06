"use client";

/**
 * ThumbnailImageEditor — Personalisiertes Vorschaubild (Paket C).
 *
 * Wiederverwendung des bestehenden Slide-Editors (`SlideCanvas`,
 * `LayersPanel`, `LayerInspector`) für ein einzelnes statisches Bild,
 * das im PDF-Brief pro Lead eingebettet wird. Strukturell identisch zu
 * `SegmentEditorSlide`, aber:
 *   - kein `kind` / `durationMs` (Thumbnail ist kein Timeline-Segment)
 *   - eigenes Persistenz-Format (`CampaignThumbnailImage`)
 *   - eingebetteter „Mit Beispiel-Lead-Daten füllen"-Toggle (Paket-C-§4)
 *
 * Wird sowohl im Wizard-Step5 als auch in der Edit-Form gespiegelt
 * (Paket-C-§3), daher in `components/editor/` (App-übergreifend).
 */

import * as React from "react";
import { Image as ImageIcon, Plus, Square, Type as TypeIcon, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CampaignThumbnailImage,
  Layer,
  LayerKind,
  SlideSegment,
} from "@/lib/segments/types";
import {
  SLIDE_STAGE_HEIGHT,
  SLIDE_STAGE_WIDTH,
} from "@/lib/segments/types";
import {
  createImageLayer,
  createShapeLayer,
  createTextLayer,
} from "@/lib/segments/defaults";
import { collectPlaceholderKeys } from "@/lib/slide/placeholders";
import type { SegmentEditorMediaItem } from "./segment-editor";
import { SlideCanvas } from "./slide/slide-canvas";
import { LayersPanel } from "./slide/layers-panel";
import { LayerInspector } from "./slide/layer-inspector";

const SYSTEM_PLACEHOLDERS = ["firstName", "lastName", "company", "pageUrl"];

/**
 * Beispiel-Lead für die optionale Live-Vorschau („Mit Beispiel-Lead-Daten
 * füllen"). Identisch zu den Vorschau-Werten im Slug-Template-Field, damit
 * der User dieselbe Person über die UI hinweg wiedererkennt.
 */
const EXAMPLE_PREVIEW_DATA: Record<string, string> = {
  firstName: "Peter",
  lastName: "Mueller",
  company: "Mueller GmbH",
  pageUrl: "app.videocomet.de/v/peter-mueller",
};

/**
 * Default-Thumbnail-Konfiguration (Paket-C-§2):
 *   - Weisser Hintergrund (neutral, hohe Kontraste)
 *   - Logo-Platzhalter (Top-Left), zentrierte Begrüssung,
 *     URL-Zeile unten zentriert.
 * `createTextLayer()` startet mit „Hallo {{firstName}}" — wir überschreiben
 * Positionen passend zum Thumbnail-Layout.
 */
export function createDefaultThumbnailImage(): CampaignThumbnailImage {
  const greeting = createTextLayer({
    x: 80,
    y: 120,
    w: SLIDE_STAGE_WIDTH - 160,
    h: 200,
    contentHtml:
      '<p style="text-align:center;font-size:72px;font-weight:700;color:#111">' +
      'Hallo <span data-placeholder="firstName">{{firstName}}</span>' +
      "</p>",
    vAlign: "middle",
  });
  const url = createTextLayer({
    x: 80,
    y: SLIDE_STAGE_HEIGHT - 160,
    w: SLIDE_STAGE_WIDTH - 160,
    h: 80,
    contentHtml:
      '<p style="text-align:center;font-size:28px;font-weight:600;color:#555">' +
      '<span data-placeholder="pageUrl">{{pageUrl}}</span>' +
      "</p>",
    vAlign: "middle",
  });
  return {
    background: { type: "color", color: "#FFFFFF" },
    layers: [greeting, url],
  };
}

export interface ThumbnailImageEditorProps {
  value: CampaignThumbnailImage;
  onChange: (next: CampaignThumbnailImage) => void;
  mediaItems: SegmentEditorMediaItem[];
  /** CSV-Spalten — optional, fliessen in die Placeholder-Vorschläge. */
  csvColumns?: string[];
}

export function ThumbnailImageEditor({
  value,
  onChange,
  mediaItems,
  csvColumns,
}: ThumbnailImageEditorProps) {
  const [selectedLayerId, setSelectedLayerId] = React.useState<string | null>(
    value.layers[value.layers.length - 1]?.id ?? null,
  );
  const [showPreviewData, setShowPreviewData] = React.useState(false);

  // `SlideCanvas` erwartet ein `SlideSegment`. Wir mappen unser
  // Thumbnail-Modell in einen synthetischen Slide (id/duration sind
  // Platzhalter — werden nicht persistiert).
  const slide: SlideSegment = React.useMemo(
    () => ({
      id: "__thumbnail__",
      kind: "slide",
      durationMs: 0,
      background: value.background,
      layers: value.layers,
    }),
    [value.background, value.layers],
  );

  function patchLayer(id: string, patch: Partial<Layer>) {
    onChange({
      ...value,
      layers: value.layers.map((l) =>
        l.id === id ? ({ ...l, ...patch } as Layer) : l,
      ),
    });
  }

  function addLayer(kind: LayerKind) {
    let layer: Layer;
    if (kind === "text") layer = createTextLayer();
    else if (kind === "image") {
      const first = mediaItems.find(
        (m) => m.type === "image" || m.type === "logo" || m.type === "webcam",
      );
      layer = createImageLayer(first?.id ?? "", first?.publicUrl ?? "");
    } else layer = createShapeLayer("rect");
    onChange({ ...value, layers: [...value.layers, layer] });
    setSelectedLayerId(layer.id);
  }

  function addShape(shape: "rect" | "ellipse") {
    const layer = createShapeLayer(shape);
    onChange({ ...value, layers: [...value.layers, layer] });
    setSelectedLayerId(layer.id);
  }

  function moveLayer(id: string, direction: "up" | "down") {
    const idx = value.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx + 1 : idx - 1;
    if (target < 0 || target >= value.layers.length) return;
    const next = [...value.layers];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...value, layers: next });
  }

  function duplicateLayer(id: string) {
    const src = value.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: Layer = {
      ...src,
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `layer-${Date.now()}`,
      x: src.x + 24,
      y: src.y + 24,
    };
    onChange({ ...value, layers: [...value.layers, copy] });
    setSelectedLayerId(copy.id);
  }

  function deleteLayer(id: string) {
    onChange({ ...value, layers: value.layers.filter((l) => l.id !== id) });
    setSelectedLayerId((cur) => (cur === id ? null : cur));
  }

  const selectedLayer =
    value.layers.find((l) => l.id === selectedLayerId) ?? null;

  const placeholderSuggestions = React.useMemo(() => {
    const set = new Set<string>(SYSTEM_PLACEHOLDERS);
    for (const col of csvColumns ?? []) set.add(col);
    for (const l of value.layers) {
      if (l.kind === "text") {
        for (const k of collectPlaceholderKeys(l.contentHtml)) set.add(k);
      }
    }
    return Array.from(set);
  }, [csvColumns, value.layers]);

  return (
    <div className="flex flex-col gap-4">
      {/* Preview-Daten-Toggle — Paket-C-§4 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-sm border border-line bg-surface-muted/50 px-4 py-2.5">
        <div>
          <p className="text-xs font-semibold text-ink">
            Mit Beispiel-Lead-Daten füllen
          </p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Substituiert{" "}
            <code className="font-mono">{"{{firstName}}"}</code>,{" "}
            <code className="font-mono">{"{{pageUrl}}"}</code> usw. mit{" "}
            <span className="font-mono">Peter</span> /{" "}
            <span className="font-mono">app.videocomet.de/v/peter-mueller</span>
            .
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-ink select-none cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={showPreviewData}
            onChange={(e) => setShowPreviewData(e.target.checked)}
          />
          Vorschau
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_300px] gap-4">
        {/* Layer-Liste */}
        <aside className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <AddBtn label="Text" icon={TypeIcon} onClick={() => addLayer("text")} />
            <AddBtn
              label="Bild"
              icon={ImageIcon}
              onClick={() => addLayer("image")}
            />
            <AddBtn
              label="Rechteck"
              icon={Square}
              onClick={() => addShape("rect")}
            />
            <AddBtn
              label="Ellipse"
              icon={Circle}
              onClick={() => addShape("ellipse")}
            />
          </div>
          <LayersPanel
            layers={value.layers}
            selectedId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onMove={moveLayer}
            onDuplicate={duplicateLayer}
            onDelete={deleteLayer}
            onToggleHidden={(id) =>
              patchLayer(id, {
                hidden: !value.layers.find((l) => l.id === id)?.hidden,
              })
            }
            onToggleLocked={(id) =>
              patchLayer(id, {
                locked: !value.layers.find((l) => l.id === id)?.locked,
              })
            }
          />
        </aside>

        {/* Bühne — die Canvas-Komponente skaliert intern via ResizeObserver
            zwischen 0 und 1, das deckt unsere Mobile-Anforderung (Paket-C-§6)
            ohne weitere Anpassung ab. */}
        <div className="min-w-0">
          <SlideCanvas
            slide={slide}
            selectedLayerId={selectedLayerId}
            previewData={showPreviewData ? EXAMPLE_PREVIEW_DATA : undefined}
            onSelectLayer={setSelectedLayerId}
            onLayerChange={patchLayer}
          />
        </div>

        {/* Inspector */}
        <aside className="min-w-0">
          <LayerInspector
            layer={selectedLayer}
            background={value.background}
            mediaItems={mediaItems}
            placeholderSuggestions={placeholderSuggestions}
            onLayerChange={patchLayer}
            onBackgroundChange={(bg) => onChange({ ...value, background: bg })}
          />
        </aside>
      </div>
    </div>
  );
}

function AddBtn({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-brand-soft text-brand-deep",
        "px-2.5 py-1 text-[11px] font-semibold hover:bg-brand/15 transition-colors",
      )}
    >
      <Plus className="size-3" />
      <Icon className="size-3" />
      {label}
    </button>
  );
}
