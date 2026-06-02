"use client";

import * as React from "react";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Video as VideoIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  GDocsSegment,
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
}

const KIND_META: Record<SegmentKind, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  text: { label: "Text", Icon: TypeIcon },
  image: { label: "Bild", Icon: ImageIcon },
  video: { label: "Video", Icon: VideoIcon },
  website: { label: "Website", Icon: Globe },
  gdocs: { label: "Google Docs", Icon: FileText },
  slide: { label: "Freie Folie", Icon: Sparkles },
};

export function SegmentEditor({
  segment,
  onChange,
  onDelete,
  mediaItems,
  webcamDurationMs,
  otherSegmentsDurationMs,
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
        />
      </div>
    </Card>
  );
}

function SegmentBody({
  segment,
  onChange,
  mediaItems,
}: {
  segment: Segment;
  onChange: (s: Segment) => void;
  mediaItems: SegmentEditorMediaItem[];
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
        />
      );
    case "gdocs":
      return (
        <SegmentEditorGDocs
          segment={segment}
          onChange={(s: GDocsSegment) => onChange(s)}
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
