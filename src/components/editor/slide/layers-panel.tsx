"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Square,
  Trash2,
  Type as TypeIcon,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Layer } from "@/lib/segments/types";

export interface LayersPanelProps {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
}

export function LayersPanel(props: LayersPanelProps) {
  const { layers } = props;
  // Layers werden umgekehrt angezeigt, weil layers[N-1] (oben im Z-Stack)
  // intuitiv als erstes in der Liste erscheinen sollte.
  const ordered = [...layers].reverse();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted px-1">
        Ebenen
      </div>
      <div className="flex flex-col gap-1">
        {ordered.length === 0 && (
          <div className="text-xs text-ink-muted px-2 py-3 text-center">
            Noch keine Ebenen
          </div>
        )}
        {ordered.map((layer) => (
          <LayerRow key={layer.id} layer={layer} {...props} />
        ))}
      </div>
    </div>
  );
}

function LayerRow({
  layer,
  selectedId,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
  onToggleHidden,
  onToggleLocked,
}: { layer: Layer } & LayersPanelProps) {
  const Icon =
    layer.kind === "text"
      ? TypeIcon
      : layer.kind === "image"
        ? ImageIcon
        : Square;
  const label =
    layer.kind === "text"
      ? layerTextSummary(layer.contentHtml)
      : layer.kind === "image"
        ? "Bild"
        : layer.kind === "shape" && layer.shape === "ellipse"
          ? "Ellipse"
          : "Rechteck";
  const active = layer.id === selectedId;
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-squircle-sm border px-2 py-1.5 text-xs transition-colors",
        active
          ? "border-brand bg-brand-soft"
          : "border-transparent hover:bg-surface-muted",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(layer.id)}
        className="flex flex-1 min-w-0 items-center gap-2 text-left"
      >
        <Icon className="size-3.5 text-ink-muted shrink-0" />
        <span className="truncate font-medium text-ink">{label}</span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <RowBtn
          aria-label="Nach oben"
          onClick={() => onMove(layer.id, "up")}
        >
          <ChevronUp className="size-3" />
        </RowBtn>
        <RowBtn
          aria-label="Nach unten"
          onClick={() => onMove(layer.id, "down")}
        >
          <ChevronDown className="size-3" />
        </RowBtn>
        <RowBtn
          aria-label="Duplizieren"
          onClick={() => onDuplicate(layer.id)}
        >
          <Copy className="size-3" />
        </RowBtn>
        <RowBtn
          aria-label={layer.locked ? "Entsperren" : "Sperren"}
          onClick={() => onToggleLocked(layer.id)}
        >
          {layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
        </RowBtn>
        <RowBtn
          aria-label={layer.hidden ? "Einblenden" : "Ausblenden"}
          onClick={() => onToggleHidden(layer.id)}
        >
          {layer.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </RowBtn>
        <RowBtn
          aria-label="Löschen"
          onClick={() => onDelete(layer.id)}
          className="text-danger hover:bg-danger/10"
        >
          <Trash2 className="size-3" />
        </RowBtn>
      </div>
    </div>
  );
}

function RowBtn({
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors",
        className,
      )}
    >
      {children}
    </button>
  );
}

function layerTextSummary(html: string): string {
  const stripped = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "Text";
  return stripped.length > 24 ? `${stripped.slice(0, 24)}…` : stripped;
}
