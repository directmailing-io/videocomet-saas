"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WebCaptureMode, WebsiteSegment } from "@/lib/segments/types";

interface SegmentEditorWebsiteProps {
  segment: WebsiteSegment;
  onChange: (segment: WebsiteSegment) => void;
}

export function SegmentEditorWebsite({
  segment,
  onChange,
}: SegmentEditorWebsiteProps) {
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`url-col-${segment.id}`}>CSV-Spalte mit URL</Label>
        <Input
          id={`url-col-${segment.id}`}
          value={segment.urlColumn}
          onChange={(e) =>
            onChange({ ...segment, urlColumn: e.target.value })
          }
          placeholder="website"
        />
      </div>

      <div>
        <Label htmlFor={`fallback-${segment.id}`}>Fallback-URL</Label>
        <Input
          id={`fallback-${segment.id}`}
          value={segment.fallbackUrl}
          onChange={(e) =>
            onChange({ ...segment, fallbackUrl: e.target.value })
          }
          placeholder="https://www.beispiel.de"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Wird in der Vorschau und fuer Leads ohne Wert verwendet.
        </p>
      </div>

      <div>
        <Label>Aufnahme-Modus</Label>
        <Select
          value={segment.captureMode}
          onValueChange={(v) =>
            onChange({ ...segment, captureMode: v as WebCaptureMode })
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="screenshot">Screenshot (statisch)</SelectItem>
            <SelectItem value="scroll">Smooth-Scroll (animiert)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 rounded-squircle-sm border border-brand-200 bg-brand-soft p-4 text-sm text-brand-deep">
        <Info className="size-4 shrink-0 mt-0.5" />
        <p>
          Beim Generieren wird die echte URL des Leads aufgenommen. Die Fallback-URL
          erscheint nur in der Vorschau bzw. wenn die Spalte leer ist.
        </p>
      </div>
    </div>
  );
}
