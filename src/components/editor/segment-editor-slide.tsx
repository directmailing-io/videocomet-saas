"use client";

import * as React from "react";
import { Image as ImageIcon, Plus, Square, Type as TypeIcon, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Layer,
  LayerKind,
  SlideSegment,
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

const SYSTEM_PLACEHOLDERS = ["firstName", "lastName", "company"];

export interface SegmentEditorSlideProps {
  segment: SlideSegment;
  onChange: (segment: SlideSegment) => void;
  mediaItems: SegmentEditorMediaItem[];
  /** Spalten-Namen der hochgeladenen Lead-CSV — werden als Auto-Vorschläge angeboten. */
  csvColumns?: string[];
  /** Beispiel-Daten zur Live-Vorschau in der Bühne. */
  previewData?: Record<string, string>;
}

export function SegmentEditorSlide({
  segment,
  onChange,
  mediaItems,
  csvColumns,
  previewData,
}: SegmentEditorSlideProps) {
  const [selectedLayerId, setSelectedLayerId] = React.useState<string | null>(
    segment.layers[segment.layers.length - 1]?.id ?? null,
  );

  // Beim Wechsel der Folie (id) Selection zurücksetzen.
  const lastSegmentIdRef = React.useRef(segment.id);
  React.useEffect(() => {
    if (lastSegmentIdRef.current !== segment.id) {
      lastSegmentIdRef.current = segment.id;
      setSelectedLayerId(segment.layers[segment.layers.length - 1]?.id ?? null);
    }
  }, [segment.id, segment.layers]);

  function patchLayer(id: string, patch: Partial<Layer>) {
    onChange({
      ...segment,
      layers: segment.layers.map((l) =>
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
    onChange({ ...segment, layers: [...segment.layers, layer] });
    setSelectedLayerId(layer.id);
  }

  function addShape(shape: "rect" | "ellipse") {
    const layer = createShapeLayer(shape);
    onChange({ ...segment, layers: [...segment.layers, layer] });
    setSelectedLayerId(layer.id);
  }

  function moveLayer(id: string, direction: "up" | "down") {
    const idx = segment.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx + 1 : idx - 1;
    if (target < 0 || target >= segment.layers.length) return;
    const next = [...segment.layers];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...segment, layers: next });
  }

  function duplicateLayer(id: string) {
    const src = segment.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: Layer = {
      ...src,
      id: crypto.randomUUID(),
      x: src.x + 24,
      y: src.y + 24,
    };
    onChange({ ...segment, layers: [...segment.layers, copy] });
    setSelectedLayerId(copy.id);
  }

  function deleteLayer(id: string) {
    onChange({ ...segment, layers: segment.layers.filter((l) => l.id !== id) });
    setSelectedLayerId((cur) => (cur === id ? null : cur));
  }

  const selectedLayer =
    segment.layers.find((l) => l.id === selectedLayerId) ?? null;

  const placeholderSuggestions = React.useMemo(() => {
    const set = new Set<string>(SYSTEM_PLACEHOLDERS);
    for (const col of csvColumns ?? []) set.add(col);
    for (const l of segment.layers) {
      if (l.kind === "text") {
        for (const k of collectPlaceholderKeys(l.contentHtml)) set.add(k);
      }
    }
    return Array.from(set);
  }, [csvColumns, segment.layers]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_320px] gap-4">
      {/* Layer-Liste */}
      <aside className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <AddBtn label="Text" icon={TypeIcon} onClick={() => addLayer("text")} />
          <AddBtn label="Bild" icon={ImageIcon} onClick={() => addLayer("image")} />
          <AddBtn label="Rechteck" icon={Square} onClick={() => addShape("rect")} />
          <AddBtn label="Ellipse" icon={Circle} onClick={() => addShape("ellipse")} />
        </div>
        <LayersPanel
          layers={segment.layers}
          selectedId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onMove={moveLayer}
          onDuplicate={duplicateLayer}
          onDelete={deleteLayer}
          onToggleHidden={(id) =>
            patchLayer(id, {
              hidden: !segment.layers.find((l) => l.id === id)?.hidden,
            })
          }
          onToggleLocked={(id) =>
            patchLayer(id, {
              locked: !segment.layers.find((l) => l.id === id)?.locked,
            })
          }
        />
      </aside>

      {/* Bühne */}
      <div className="min-w-0">
        <SlideCanvas
          slide={segment}
          selectedLayerId={selectedLayerId}
          previewData={previewData}
          onSelectLayer={setSelectedLayerId}
          onLayerChange={patchLayer}
        />
      </div>

      {/* Inspector */}
      <aside className="min-w-0">
        <LayerInspector
          layer={selectedLayer}
          background={segment.background}
          mediaItems={mediaItems}
          placeholderSuggestions={placeholderSuggestions}
          onLayerChange={patchLayer}
          onBackgroundChange={(bg) => onChange({ ...segment, background: bg })}
        />
      </aside>
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
