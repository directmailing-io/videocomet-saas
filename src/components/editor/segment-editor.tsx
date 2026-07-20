"use client";

import * as React from "react";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Presentation,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Video as VideoIcon,
  Wand2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  CanvaSegment,
  GDocsSegment,
  GSlideSegment,
  ImageSegment,
  Segment,
  SegmentKind,
  SlideSegment,
  TextSegment,
  VideoSegment,
  WebsiteSegment,
} from "@/lib/segments/types";
import { DurationInput } from "./duration-input";
import { SegmentEditorText } from "./segment-editor-text";
import { SegmentEditorImage } from "./segment-editor-image";
import { SegmentEditorVideo } from "./segment-editor-video";
import { SegmentEditorWebsite } from "./segment-editor-website";
import { SegmentEditorGDocs } from "./segment-editor-gdocs";
import { SegmentEditorGSlide } from "./segment-editor-gslide";
import { SegmentEditorCanva } from "./segment-editor-canva";
import { SegmentEditorSlide } from "./segment-editor-slide";

export interface SegmentEditorMediaItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

export interface SegmentEditorProps {
  segment: Segment;
  onChange: (segment: Segment) => void;
  onDelete: () => void;
  mediaItems: SegmentEditorMediaItem[];
  /** Optional: die Webcam-Dauer als hartes Gesamt-Limit. */
  webcamDurationMs?: number | null;
  /**
   * Summe der Dauern aller ANDEREN Segmente. Wird genutzt, um das harte
   * Maximum für dieses Segment zu berechnen: webcam - other = maxForThis.
   */
  otherSegmentsDurationMs?: number;
  /**
   * Bunny-CDN-URL der Webcam-Aufnahme. Wird für die optionale
   * Webcam-PiP-Vorschau im Scroll-Recorder durchgereicht.
   */
  webcamUrl?: string | null;
  /**
   * Alle Segmente der Timeline. Wird für die Berechnung der Webcam-
   * Zeitfenster (segmentStartMs) im Scroll-Recorder benötigt.
   */
  allSegments?: Segment[];
  /**
   * Index dieses Segments innerhalb von `allSegments`. Null = kein
   * Index bekannt (z. B. vor Selektion); in dem Fall ist der
   * Webcam-Monitor-Toggle disabled.
   */
  currentSegmentIndex?: number | null;
  /**
   * Wenn gesetzt, wird für "Freie Folie"-Segmente statt des breiten
   * Inline-Editors ein Button gerendert, der den Vollbild-Folien-Editor
   * öffnet (Panel-Modus im Studio-Layout).
   */
  onOpenSlideEditor?: () => void;
}

const KIND_META: Record<SegmentKind, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  text: { label: "Text", Icon: TypeIcon },
  image: { label: "Bild", Icon: ImageIcon },
  video: { label: "Video", Icon: VideoIcon },
  website: { label: "Website", Icon: Globe },
  gdocs: { label: "Google Docs", Icon: FileText },
  gslide: { label: "Google Slide", Icon: Presentation },
  canva: { label: "Canva-Folie", Icon: Wand2 },
  slide: { label: "Freie Folie", Icon: Sparkles },
};

export function SegmentEditor({
  segment,
  onChange,
  onDelete,
  mediaItems,
  webcamDurationMs,
  otherSegmentsDurationMs,
  webcamUrl,
  allSegments,
  currentSegmentIndex,
  onOpenSlideEditor,
}: SegmentEditorProps) {
  const meta = KIND_META[segment.kind];
  const Icon = meta.Icon;

  // Hartes Maximum: Webcam-Dauer minus Summe der anderen Segmente.
  // Wenn die Caller-Komponente otherSegmentsDurationMs nicht setzt, fallen
  // wir defensiv auf das volle Webcam-Limit zurück.
  const maxMs =
    webcamDurationMs != null
      ? Math.max(
          200,
          webcamDurationMs - (otherSegmentsDurationMs ?? 0),
        )
      : undefined;

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-line bg-surface-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {segment.label?.trim() || meta.label}
            </p>
            {currentSegmentIndex != null &&
              currentSegmentIndex >= 0 &&
              allSegments &&
              allSegments.length > 0 && (
                <p className="text-[11px] font-medium text-ink-muted">
                  Segment {currentSegmentIndex + 1} von {allSegments.length}
                </p>
              )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="shrink-0 text-danger hover:bg-danger/10 hover:border-danger/40"
            aria-label="Segment löschen"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-ink-muted">Dauer</span>
          <DurationInput
            valueMs={segment.durationMs}
            onChange={(ms) => onChange({ ...segment, durationMs: ms })}
            maxMs={maxMs}
            compact
          />
        </div>
      </div>

      <div className="p-4">
        <SegmentBody
          segment={segment}
          onChange={onChange}
          mediaItems={mediaItems}
          webcamUrl={webcamUrl ?? null}
          allSegments={allSegments ?? null}
          currentSegmentIndex={currentSegmentIndex ?? null}
          onOpenSlideEditor={onOpenSlideEditor ?? null}
        />
      </div>
    </Card>
  );
}

function SegmentBody({
  segment,
  onChange,
  mediaItems,
  webcamUrl,
  allSegments,
  currentSegmentIndex,
  onOpenSlideEditor,
}: {
  segment: Segment;
  onChange: (s: Segment) => void;
  mediaItems: SegmentEditorMediaItem[];
  webcamUrl: string | null;
  allSegments: Segment[] | null;
  currentSegmentIndex: number | null;
  onOpenSlideEditor: (() => void) | null;
}) {
  switch (segment.kind) {
    case "text":
      return (
        <SegmentEditorText
          segment={segment}
          onChange={(s: TextSegment) => onChange(s)}
        />
      );
    case "image":
      return (
        <SegmentEditorImage
          segment={segment}
          onChange={(s: ImageSegment) => onChange(s)}
          mediaItems={mediaItems}
        />
      );
    case "video":
      return (
        <SegmentEditorVideo
          segment={segment}
          onChange={(s: VideoSegment) => onChange(s)}
          mediaItems={mediaItems}
        />
      );
    case "website":
      return (
        <SegmentEditorWebsite
          segment={segment}
          onChange={(s: WebsiteSegment) => onChange(s)}
          webcamUrl={webcamUrl}
          allSegments={allSegments ?? undefined}
          currentSegmentIndex={currentSegmentIndex}
        />
      );
    case "gdocs":
      return (
        <SegmentEditorGDocs
          segment={segment}
          onChange={(s: GDocsSegment) => onChange(s)}
          webcamUrl={webcamUrl}
          allSegments={allSegments ?? undefined}
          currentSegmentIndex={currentSegmentIndex}
        />
      );
    case "gslide":
      return (
        <SegmentEditorGSlide
          segment={segment}
          onChange={(s: GSlideSegment) => onChange(s)}
        />
      );
    case "slide":
      if (onOpenSlideEditor) {
        return (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-ink-muted">
              Freie Folien gestaltest du im großen Folien-Editor mit Texten,
              Bildern, Formen und Platzhaltern.
            </p>
            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={onOpenSlideEditor}
              iconLeft={<Sparkles className="size-3.5" />}
              className="w-full"
            >
              Folie gestalten (Vollbild)
            </Button>
          </div>
        );
      }
      return (
        <SegmentEditorSlide
          segment={segment}
          onChange={(s: SlideSegment) => onChange(s)}
          mediaItems={mediaItems}
        />
      );
    case "canva":
      return (
        <SegmentEditorCanva
          segment={segment}
          onChange={(s: CanvaSegment) => onChange(s)}
        />
      );
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}
