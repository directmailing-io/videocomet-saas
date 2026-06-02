/**
 * SlideRender — pure visuelle Darstellung einer SlideSegment.
 *
 * Dieselbe Komponente wird genutzt für:
 *   1. Editor-Bühne (Live-Vorschau, react-moveable-Overlay sitzt darüber)
 *   2. Worker-Renderer (renderToStaticMarkup → HTML-Page → Puppeteer-Screenshot)
 *
 * Strenge Anforderungen:
 *   - Keine Browser-Globals (`window`, `document`, …) — muss auf Node laufen.
 *   - Keine Client-Hooks — pure stateless function.
 *   - Layer-Reihenfolge = Z-Index (layers[0] zuunterst).
 */

import * as React from "react";
import {
  SLIDE_STAGE_HEIGHT,
  SLIDE_STAGE_WIDTH,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type SlideBackground,
  type SlideSegment,
  type TextLayer,
} from "../segments/types";
import { resolvePlaceholders } from "./placeholders";

export interface SlideRenderProps {
  slide: SlideSegment;
  /** Lead-Daten für Placeholder-Substitution. Leer = Editor-Vorschau-Modus. */
  leadData?: Record<string, string>;
  /**
   * Skalierungsfaktor relativ zur Stage (1 = native 1280×720). Im Editor
   * setzen wir typischerweise 0.45 oder ähnlich, im Renderer immer 1.
   */
  scale?: number;
  /** Wenn `true`, wird die Bühne in einen overflow:hidden-Container gepackt. */
  clip?: boolean;
}

export function SlideRender({
  slide,
  leadData,
  scale = 1,
  clip = true,
}: SlideRenderProps) {
  const w = SLIDE_STAGE_WIDTH * scale;
  const h = SLIDE_STAGE_HEIGHT * scale;
  return (
    <div
      style={{
        position: "relative",
        width: `${w}px`,
        height: `${h}px`,
        overflow: clip ? "hidden" : "visible",
        background: "#fff",
      }}
      data-slide-render="true"
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${SLIDE_STAGE_WIDTH}px`,
          height: `${SLIDE_STAGE_HEIGHT}px`,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <Background bg={slide.background} />
        {slide.layers.map((layer) => (
          <LayerView key={layer.id} layer={layer} leadData={leadData} />
        ))}
      </div>
    </div>
  );
}

function Background({ bg }: { bg: SlideBackground }) {
  if (bg.type === "color") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: bg.color,
        }}
      />
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url("${bg.publicUrl}")`,
        backgroundSize: bg.fit === "cover" ? "cover" : "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        background: bg.fit === "cover" ? undefined : "#fff",
      }}
    />
  );
}

function LayerView({
  layer,
  leadData,
}: {
  layer: Layer;
  leadData: Record<string, string> | undefined;
}) {
  if (layer.hidden) return null;
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${layer.x}px`,
    top: `${layer.y}px`,
    width: `${layer.w}px`,
    height: `${layer.h}px`,
    transform: layer.rot ? `rotate(${layer.rot}deg)` : undefined,
    transformOrigin: "center center",
    opacity: layer.opacity,
  };
  if (layer.kind === "text") {
    return <TextLayerView layer={layer} leadData={leadData} style={base} />;
  }
  if (layer.kind === "image") {
    return <ImageLayerView layer={layer} style={base} />;
  }
  return <ShapeLayerView layer={layer} style={base} />;
}

function TextLayerView({
  layer,
  leadData,
  style,
}: {
  layer: TextLayer;
  leadData: Record<string, string> | undefined;
  style: React.CSSProperties;
}) {
  const html = leadData
    ? resolvePlaceholders(layer.contentHtml, leadData)
    : layer.contentHtml;
  const justify =
    layer.vAlign === "top"
      ? "flex-start"
      : layer.vAlign === "bottom"
        ? "flex-end"
        : "center";
  return (
    <div
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        // Default-Inhalts-Styles falls Tiptap noch keine setzt
        color: "#111",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "32px",
        lineHeight: 1.2,
        // Tight wrap — Folien-Layer sollen nicht überlaufen
        overflowWrap: "break-word",
        wordBreak: "break-word",
      }}
      // We render Tiptap-HTML directly. The Editor sanitises beim Save.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ImageLayerView({
  layer,
  style,
}: {
  layer: ImageLayer;
  style: React.CSSProperties;
}) {
  if (!layer.publicUrl) {
    return (
      <div
        style={{
          ...style,
          background: "#f3f4f6",
          border: "1px dashed #c1c4c9",
        }}
      />
    );
  }
  return (
    <img
      src={layer.publicUrl}
      alt=""
      style={{
        ...style,
        objectFit: layer.fit === "cover" ? "cover" : "contain",
        objectPosition: "center",
      }}
    />
  );
}

function ShapeLayerView({
  layer,
  style,
}: {
  layer: ShapeLayer;
  style: React.CSSProperties;
}) {
  const radius = layer.shape === "ellipse" ? "50%" : `${layer.cornerRadius}px`;
  return (
    <div
      style={{
        ...style,
        background: layer.fill,
        borderRadius: radius,
        border:
          layer.stroke && layer.strokeWidth > 0
            ? `${layer.strokeWidth}px solid ${layer.stroke}`
            : undefined,
      }}
    />
  );
}
