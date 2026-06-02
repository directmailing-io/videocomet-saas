"use client";

import * as React from "react";
import Moveable from "react-moveable";
import {
  SLIDE_STAGE_HEIGHT,
  SLIDE_STAGE_WIDTH,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type SlideSegment,
  type TextLayer,
} from "@/lib/segments/types";
import { resolvePlaceholders } from "@/lib/slide/placeholders";
import { cn } from "@/lib/utils";

export interface SlideCanvasProps {
  slide: SlideSegment;
  selectedLayerId: string | null;
  /** Preview-Daten (eines Beispiel-Leads) für Live-Vorschau. */
  previewData?: Record<string, string>;
  onSelectLayer: (id: string | null) => void;
  onLayerChange: (id: string, patch: Partial<Layer>) => void;
}

export function SlideCanvas({
  slide,
  selectedLayerId,
  previewData,
  onSelectLayer,
  onLayerChange,
}: SlideCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const layerRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [scale, setScale] = React.useState(1);
  // Force re-render of Moveable when layers change so it picks up new position
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  React.useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const w = e.contentRect.width;
      const next = Math.min(1, w / SLIDE_STAGE_WIDTH);
      setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const target = selectedLayerId
    ? layerRefs.current.get(selectedLayerId) ?? null
    : null;

  const selectedLayer = selectedLayerId
    ? slide.layers.find((l) => l.id === selectedLayerId) ?? null
    : null;

  const innerHeight = SLIDE_STAGE_HEIGHT * scale;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-squircle-md border border-line bg-surface-muted shadow-sm"
        style={{ height: innerHeight, maxWidth: SLIDE_STAGE_WIDTH }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onSelectLayer(null);
        }}
      >
        <div
          style={{
            width: SLIDE_STAGE_WIDTH,
            height: SLIDE_STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            position: "relative",
          }}
        >
          {/* Background */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                slide.background.type === "color"
                  ? slide.background.color
                  : `url("${slide.background.publicUrl}") center/${
                      slide.background.fit === "cover" ? "cover" : "contain"
                    } no-repeat`,
              backgroundColor: "#fff",
            }}
          />
          {/* Layers */}
          {slide.layers.map((layer) => {
            if (layer.hidden) return null;
            return (
              <LayerElement
                key={layer.id}
                layer={layer}
                previewData={previewData}
                selected={layer.id === selectedLayerId}
                onSelect={() => onSelectLayer(layer.id)}
                bindRef={(el) => {
                  if (el) layerRefs.current.set(layer.id, el);
                  else layerRefs.current.delete(layer.id);
                  force();
                }}
              />
            );
          })}

          {target && selectedLayer && !selectedLayer.locked && (
            <Moveable
              target={target}
              draggable
              resizable
              rotatable
              throttleDrag={1}
              throttleResize={1}
              throttleRotate={1}
              keepRatio={false}
              snappable
              snapDirections={{ top: true, left: true, right: true, bottom: true, center: true, middle: true }}
              elementSnapDirections={{ top: true, left: true, right: true, bottom: true, center: true, middle: true }}
              snapThreshold={6}
              bounds={{ left: 0, top: 0, right: SLIDE_STAGE_WIDTH, bottom: SLIDE_STAGE_HEIGHT }}
              onDrag={({ left, top }) => {
                onLayerChange(selectedLayer.id, {
                  x: Math.round(left),
                  y: Math.round(top),
                });
              }}
              onResize={({ width, height, drag }) => {
                onLayerChange(selectedLayer.id, {
                  x: Math.round(drag.left),
                  y: Math.round(drag.top),
                  w: Math.max(20, Math.round(width)),
                  h: Math.max(20, Math.round(height)),
                });
              }}
              onRotate={({ rotation }) => {
                onLayerChange(selectedLayer.id, {
                  rot: Math.round(rotation),
                });
              }}
              renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
              origin={false}
              zoom={scale}
            />
          )}
        </div>
      </div>
      <p className="text-[11px] text-ink-muted">
        Bühne 1280 × 720 · Skalierung {(scale * 100).toFixed(0)} % · Klick auf
        Bühnen-Hintergrund hebt Auswahl auf
      </p>
    </div>
  );
}

function LayerElement({
  layer,
  previewData,
  selected,
  onSelect,
  bindRef,
}: {
  layer: Layer;
  previewData: Record<string, string> | undefined;
  selected: boolean;
  onSelect: () => void;
  bindRef: (el: HTMLDivElement | null) => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.w,
    height: layer.h,
    transform: layer.rot ? `rotate(${layer.rot}deg)` : undefined,
    transformOrigin: "center center",
    opacity: layer.opacity,
    cursor: layer.locked ? "default" : "move",
  };
  return (
    <div
      ref={bindRef}
      style={baseStyle}
      className={cn(
        "outline outline-1 outline-transparent",
        selected && !layer.locked && "outline-brand outline-offset-2",
      )}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {layer.kind === "text" && (
        <TextContent layer={layer} previewData={previewData} />
      )}
      {layer.kind === "image" && <ImageContent layer={layer} />}
      {layer.kind === "shape" && <ShapeContent layer={layer} />}
    </div>
  );
}

function TextContent({
  layer,
  previewData,
}: {
  layer: TextLayer;
  previewData?: Record<string, string>;
}) {
  const html = previewData
    ? resolvePlaceholders(layer.contentHtml, previewData)
    : layer.contentHtml;
  const justify =
    layer.vAlign === "top"
      ? "flex-start"
      : layer.vAlign === "bottom"
        ? "flex-end"
        : "center";
  return (
    <div
      className="vc-tiptap"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        color: "#111",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 32,
        lineHeight: 1.2,
        overflow: "hidden",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        pointerEvents: "none",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ImageContent({ layer }: { layer: ImageLayer }) {
  if (!layer.publicUrl) {
    return (
      <div className="w-full h-full bg-surface-muted border border-dashed border-line flex items-center justify-center text-[11px] text-ink-muted">
        Kein Bild
      </div>
    );
  }
  return (
    <img
      src={layer.publicUrl}
      alt=""
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: layer.fit === "cover" ? "cover" : "contain",
        objectPosition: "center",
        pointerEvents: "none",
      }}
    />
  );
}

function ShapeContent({ layer }: { layer: ShapeLayer }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: layer.fill,
        borderRadius:
          layer.shape === "ellipse" ? "50%" : layer.cornerRadius,
        border:
          layer.stroke && layer.strokeWidth > 0
            ? `${layer.strokeWidth}px solid ${layer.stroke}`
            : undefined,
        pointerEvents: "none",
      }}
    />
  );
}
