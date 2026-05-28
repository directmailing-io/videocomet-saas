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
import type { GDocsSegment, WebCaptureMode } from "@/lib/segments/types";

interface SegmentEditorGDocsProps {
  segment: GDocsSegment;
  onChange: (segment: GDocsSegment) => void;
}

function isValidDocsUrl(url: string): boolean {
  if (!url) return true; // empty allowed (no error yet)
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("docs.google.com");
  } catch {
    return false;
  }
}

export function SegmentEditorGDocs({
  segment,
  onChange,
}: SegmentEditorGDocsProps) {
  const urlValid = isValidDocsUrl(segment.docsUrl);

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`docs-url-${segment.id}`}>Google-Docs-URL</Label>
        <Input
          id={`docs-url-${segment.id}`}
          value={segment.docsUrl}
          onChange={(e) =>
            onChange({ ...segment, docsUrl: e.target.value })
          }
          placeholder="https://docs.google.com/document/d/..."
          error={!urlValid}
        />
        {!urlValid && (
          <p className="mt-1 text-xs text-danger">
            Bitte eine gueltige docs.google.com URL angeben.
          </p>
        )}
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
          Das Dokument muss oeffentlich (mit Link freigegeben) sein, damit es waehrend
          des Renderns geladen werden kann.
        </p>
      </div>
    </div>
  );
}
