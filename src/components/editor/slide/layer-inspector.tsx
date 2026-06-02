"use client";

import * as React from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ImageLayer,
  Layer,
  ShapeLayer,
  SlideBackground,
  TextLayer,
} from "@/lib/segments/types";
import type { SegmentEditorMediaItem } from "../segment-editor";
import { RichTextEditor } from "./rich-text-editor";

export interface LayerInspectorProps {
  layer: Layer | null;
  background: SlideBackground;
  mediaItems: SegmentEditorMediaItem[];
  placeholderSuggestions: string[];
  onLayerChange: (id: string, patch: Partial<Layer>) => void;
  onBackgroundChange: (bg: SlideBackground) => void;
}

export function LayerInspector(props: LayerInspectorProps) {
  const { layer, background, onBackgroundChange, mediaItems } = props;
  return (
    <div className="flex flex-col gap-5">
      <BackgroundSection
        background={background}
        onChange={onBackgroundChange}
        mediaItems={mediaItems}
      />
      <div className="h-px bg-line" />
      {layer ? (
        <LayerForm {...props} layer={layer} />
      ) : (
        <div className="rounded-squircle-sm border border-dashed border-line bg-surface-muted/40 p-4 text-center text-xs text-ink-muted">
          Wähle eine Ebene auf der Bühne oder in der Liste links.
        </div>
      )}
    </div>
  );
}

function BackgroundSection({
  background,
  onChange,
  mediaItems,
}: {
  background: SlideBackground;
  onChange: (bg: SlideBackground) => void;
  mediaItems: SegmentEditorMediaItem[];
}) {
  const images = mediaItems.filter(
    (m) => m.type === "image" || m.type === "logo",
  );
  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
        Hintergrund
      </h4>
      <div className="flex items-center gap-2 mb-2">
        <SegBtn
          active={background.type === "color"}
          onClick={() =>
            onChange({
              type: "color",
              color: background.type === "color" ? background.color : "#FAFAFA",
            })
          }
        >
          Farbe
        </SegBtn>
        <SegBtn
          active={background.type === "image"}
          onClick={() => {
            if (background.type === "image") return;
            const first = images[0];
            if (first) {
              onChange({
                type: "image",
                mediaId: first.id,
                publicUrl: first.publicUrl,
                fit: "cover",
              });
            }
          }}
        >
          Bild
        </SegBtn>
      </div>
      {background.type === "color" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={background.color}
            onChange={(e) => onChange({ type: "color", color: e.target.value })}
            className="h-9 w-12 cursor-pointer rounded-squircle-sm border border-line bg-surface p-0"
          />
          <span className="font-mono text-xs text-ink-soft">
            {background.color}
          </span>
        </div>
      ) : (
        <>
          <select
            value={background.mediaId}
            onChange={(e) => {
              const m = images.find((x) => x.id === e.target.value);
              if (!m) return;
              onChange({
                type: "image",
                mediaId: m.id,
                publicUrl: m.publicUrl,
                fit: background.fit,
              });
            }}
            className="w-full rounded-squircle-sm border border-line bg-surface px-2 py-1.5 text-xs"
          >
            {images.length === 0 && <option>Keine Bilder verfügbar</option>}
            {images.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Anpassung</span>
            <SegBtn
              active={background.fit === "cover"}
              onClick={() =>
                onChange({ ...background, fit: "cover" })
              }
            >
              Cover
            </SegBtn>
            <SegBtn
              active={background.fit === "contain"}
              onClick={() =>
                onChange({ ...background, fit: "contain" })
              }
            >
              Contain
            </SegBtn>
          </div>
        </>
      )}
    </section>
  );
}

function LayerForm({
  layer,
  mediaItems,
  placeholderSuggestions,
  onLayerChange,
}: LayerInspectorProps & { layer: Layer }) {
  return (
    <section className="flex flex-col gap-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Ebene
      </h4>

      <PositionGrid layer={layer} onChange={onLayerChange} />

      <OpacityField layer={layer} onChange={onLayerChange} />

      {layer.kind === "text" && (
        <TextLayerForm
          layer={layer}
          onChange={onLayerChange}
          placeholderSuggestions={placeholderSuggestions}
        />
      )}

      {layer.kind === "image" && (
        <ImageLayerForm
          layer={layer}
          mediaItems={mediaItems}
          onChange={onLayerChange}
        />
      )}

      {layer.kind === "shape" && (
        <ShapeLayerForm layer={layer} onChange={onLayerChange} />
      )}
    </section>
  );
}

function PositionGrid({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (id: string, patch: Partial<Layer>) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Num label="X" value={layer.x} onChange={(v) => onChange(layer.id, { x: v })} />
      <Num label="Y" value={layer.y} onChange={(v) => onChange(layer.id, { y: v })} />
      <Num label="B" value={layer.w} onChange={(v) => onChange(layer.id, { w: v })} />
      <Num label="H" value={layer.h} onChange={(v) => onChange(layer.id, { h: v })} />
      <Num
        label="Rot°"
        value={layer.rot}
        onChange={(v) => onChange(layer.id, { rot: v })}
      />
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase text-ink-muted">
        {label}
      </span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="h-7 rounded-squircle-sm border border-line bg-surface px-2 text-xs tabular-nums"
      />
    </label>
  );
}

function OpacityField({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (id: string, patch: Partial<Layer>) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase text-ink-muted">
        Opazität · {Math.round(layer.opacity * 100)} %
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(layer.opacity * 100)}
        onChange={(e) =>
          onChange(layer.id, { opacity: parseInt(e.target.value, 10) / 100 })
        }
        className="w-full accent-brand"
      />
    </label>
  );
}

function TextLayerForm({
  layer,
  onChange,
  placeholderSuggestions,
}: {
  layer: TextLayer;
  onChange: (id: string, patch: Partial<Layer>) => void;
  placeholderSuggestions: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase text-ink-muted mb-1">
          Vertikal
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
          {(["top", "middle", "bottom"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(layer.id, { vAlign: v })}
              className={cn(
                "h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors",
                layer.vAlign === v
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:bg-surface-muted",
              )}
            >
              {v === "top" ? "Oben" : v === "middle" ? "Mitte" : "Unten"}
            </button>
          ))}
        </div>
      </div>

      <RichTextEditor
        contentHtml={layer.contentHtml}
        onChange={(html) => onChange(layer.id, { contentHtml: html })}
        placeholderSuggestions={placeholderSuggestions}
      />
    </div>
  );
}

function ImageLayerForm({
  layer,
  mediaItems,
  onChange,
}: {
  layer: ImageLayer;
  mediaItems: SegmentEditorMediaItem[];
  onChange: (id: string, patch: Partial<Layer>) => void;
}) {
  const images = mediaItems.filter(
    (m) => m.type === "image" || m.type === "logo" || m.type === "webcam",
  );
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase text-ink-muted mb-1">
          Quelle
        </div>
        <select
          value={layer.mediaId}
          onChange={(e) => {
            const m = images.find((x) => x.id === e.target.value);
            if (!m) return;
            onChange(layer.id, { mediaId: m.id, publicUrl: m.publicUrl } as Partial<Layer>);
          }}
          className="w-full rounded-squircle-sm border border-line bg-surface px-2 py-1.5 text-xs"
        >
          {!layer.mediaId && <option value="">— Bild wählen —</option>}
          {images.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase text-ink-muted mb-1">
          Anpassung
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
          {(["cover", "contain"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(layer.id, { fit: v } as Partial<Layer>)}
              className={cn(
                "h-7 px-3 rounded-full text-[11px] font-semibold transition-colors",
                layer.fit === v
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:bg-surface-muted",
              )}
            >
              {v === "cover" ? "Cover" : "Contain"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShapeLayerForm({
  layer,
  onChange,
}: {
  layer: ShapeLayer;
  onChange: (id: string, patch: Partial<Layer>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase text-ink-muted mb-1">
          Form
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
          {(["rect", "ellipse"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(layer.id, { shape: v } as Partial<Layer>)}
              className={cn(
                "h-7 px-3 rounded-full text-[11px] font-semibold transition-colors",
                layer.shape === v
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:bg-surface-muted",
              )}
            >
              {v === "rect" ? "Rechteck" : "Ellipse"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[10px] font-semibold uppercase text-ink-muted">
            Füllung
          </span>
          <input
            type="color"
            value={layer.fill}
            onChange={(e) =>
              onChange(layer.id, { fill: e.target.value } as Partial<Layer>)
            }
            className="h-8 w-full cursor-pointer rounded-squircle-sm border border-line bg-surface p-0"
          />
        </label>
        <label className="flex flex-col gap-1 w-24">
          <span className="text-[10px] font-semibold uppercase text-ink-muted">
            Rand
          </span>
          <input
            type="color"
            value={layer.stroke ?? "#000000"}
            onChange={(e) =>
              onChange(layer.id, { stroke: e.target.value } as Partial<Layer>)
            }
            className="h-8 w-full cursor-pointer rounded-squircle-sm border border-line bg-surface p-0"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Num
          label="Randbreite"
          value={layer.strokeWidth}
          onChange={(v) =>
            onChange(layer.id, { strokeWidth: Math.max(0, v) } as Partial<Layer>)
          }
        />
        {layer.shape === "rect" && (
          <Num
            label="Radius"
            value={layer.cornerRadius}
            onChange={(v) =>
              onChange(layer.id, {
                cornerRadius: Math.max(0, v),
              } as Partial<Layer>)
            }
          />
        )}
      </div>
    </div>
  );
}

function SegBtn({
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "h-7 px-3 rounded-full text-[11px] font-semibold border transition-colors",
        active
          ? "bg-brand text-white border-brand"
          : "bg-surface text-ink-muted border-line hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}
