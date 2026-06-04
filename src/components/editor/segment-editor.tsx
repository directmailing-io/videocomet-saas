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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
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
}

const KIND_META: Record<SegmentKind, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  text: { label: "Text", Icon: TypeIcon },
  image: { label: "Bild", Icon: ImageIcon },
  video: { label: "Video", Icon: VideoIcon },
  website: { label: "Website", Icon: Globe },
  gdocs: { label: "Google Docs", Icon: FileText },
  gslide: { label: "Google Slide", Icon: Presentation },
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
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-soft px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-ink">
            {segment.label?.trim() || meta.label}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <DurationInput
            valueMs={segment.durationMs}
            onChange={(ms) => onChange({ ...segment, durationMs: ms })}
            maxMs={maxMs}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            iconLeft={<Trash2 className="size-3.5" />}
            className="text-danger hover:bg-danger/10 hover:border-danger/40"
            aria-label="Segment löschen"
          >
            Löschen
          </Button>
        </div>
      </div>

      <div className="p-5">
        <SegmentBody
          segment={segment}
          onChange={onChange}
          mediaItems={mediaItems}
          webcamUrl={webcamUrl ?? null}
          allSegments={allSegments ?? null}
          currentSegmentIndex={currentSegmentIndex ?? null}
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
}: {
  segment: Segment;
  onChange: (s: Segment) => void;
  mediaItems: SegmentEditorMediaItem[];
  webcamUrl: string | null;
  allSegments: Segment[] | null;
  currentSegmentIndex: number | null;
}) {
  switch (segment.kind) {
    case "text":
      return (
        <SegmentEditorText
          segment={segment}
          onChange={(s: TextSegment) => onChange(s)}
          onConvertToSlide={(s) => onChange(s)}
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
      return (
        <SegmentEditorSlide
          segment={segment}
          onChange={(s: SlideSegment) => onChange(s)}
          mediaItems={mediaItems}
        />
      );
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}
