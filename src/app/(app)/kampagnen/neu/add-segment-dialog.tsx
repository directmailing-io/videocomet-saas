"use client";

import * as React from "react";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Presentation,
  Sparkles,
  Type,
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

interface SegmentTypeGroup {
  label: string;
  options: SegmentTypeOption[];
}

const SEGMENT_TYPE_GROUPS: SegmentTypeGroup[] = [
  {
    label: "Folien & Präsentationen",
    options: [
      {
        kind: "slide",
        title: "Freie Folie",
        description: "Eigene Folie mit Texten, Bildern und Formen gestalten.",
        Icon: Sparkles,
      },
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
        kind: "text",
        title: "Einfacher Text",
        description: "Kurze Textbotschaft, z. B. mit Namen des Empfängers.",
        Icon: Type,
      },
    ],
  },
  {
    label: "Bilder & Videos",
    options: [
      {
        kind: "image",
        title: "Bild",
        description: "Ein Bild aus der Mediathek zeigen.",
        Icon: ImageIcon,
      },
      {
        kind: "video",
        title: "Video",
        description: "Einen Videoclip aus der Mediathek abspielen.",
        Icon: VideoIcon,
      },
    ],
  },
  {
    label: "Webseiten & Dokumente",
    options: [
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
    ],
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
    <div className={cn("space-y-5", className)}>
      {SEGMENT_TYPE_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {group.label}
          </p>
          <div
            className={cn(
              "grid grid-cols-1 gap-2.5",
              columns === 2 && "sm:grid-cols-2",
            )}
          >
            {group.options.map(({ kind, title, description, Icon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => onSelect(kind)}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-squircle-md border border-line bg-surface p-3.5 text-left transition",
                  "hover:border-brand-200 hover:bg-brand-soft/40",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-surface-soft text-ink transition-colors group-hover:bg-brand group-hover:text-white">
                  <Icon className="size-4" />
                </span>
                <span className="flex flex-col gap-0.5">
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
        </div>
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
