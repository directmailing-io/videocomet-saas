"use client";

import * as React from "react";
import {
  FileText,
  Globe,
  Presentation,
  Video as VideoIcon,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SegmentKind } from "@/lib/segments/types";

interface SegmentTypeOption {
  kind: SegmentKind;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const SEGMENT_TYPE_OPTIONS: SegmentTypeOption[] = [
  {
    kind: "gslide",
    title: "Google Slides",
    description: "Fertige Präsentation aus Google Slides importieren.",
    Icon: Presentation,
  },
  {
    kind: "canva",
    title: "Canva",
    description: "Design aus Canva importieren und einbinden.",
    Icon: Wand2,
  },
  {
    kind: "video",
    title: "Video",
    description: "Einen Videoclip aus der Mediathek abspielen.",
    Icon: VideoIcon,
  },
  {
    kind: "website",
    title: "Webseite",
    description: "Eine Webseite wird automatisch durchgescrollt.",
    Icon: Globe,
  },
  {
    kind: "gdocs",
    title: "Google Docs",
    description: "Ein Google-Dokument zeigen, z. B. ein Angebot.",
    Icon: FileText,
  },
];

interface SegmentTypeGridProps {
  onSelect: (kind: SegmentKind) => void;
  className?: string;
  /** 1 = einspaltig (schmales Panel), 2 = zweispaltig ab sm (Dialog). */
  columns?: 1 | 2;
}

export function SegmentTypeGrid({
  onSelect,
  className,
  columns = 2,
}: SegmentTypeGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2",
        columns === 2 && "sm:grid-cols-2",
        className,
      )}
    >
      {SEGMENT_TYPE_OPTIONS.map(({ kind, title, description, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onSelect(kind)}
          className={cn(
            "group flex w-full items-center gap-3 rounded-squircle-md bg-surface-soft p-3 text-left transition",
            "hover:bg-brand-soft/40",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep transition-colors group-hover:bg-brand group-hover:text-white">
            <Icon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-tight text-ink">
              {title}
            </span>
            <span className="text-xs leading-snug text-ink-muted">
              {description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface AddSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (kind: SegmentKind) => void;
}

export function AddSegmentDialog({
  open,
  onOpenChange,
  onSelect,
}: AddSegmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Segment hinzufügen</DialogTitle>
          <DialogDescription>
            Was soll neben deinem Webcam-Video gezeigt werden?
          </DialogDescription>
        </DialogHeader>
        <SegmentTypeGrid onSelect={onSelect} className="mt-2" />
      </DialogContent>
    </Dialog>
  );
}
