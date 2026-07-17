"use client";

import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Segment, TextSegment } from "@/lib/segments/types";
import { textSegmentToSlide } from "@/lib/segments/defaults";
import { AdvancedSettings } from "./advanced-settings";

interface SegmentEditorTextProps {
  segment: TextSegment;
  onChange: (segment: TextSegment) => void;
  /** Optional: erlaubt es, die Folie in eine freie Folie zu konvertieren. */
  onConvertToSlide?: (slide: Segment) => void;
}

const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{firstName}}", label: "Vorname" },
  { token: "{{lastName}}", label: "Nachname" },
  { token: "{{company}}", label: "Firma" },
];

export function SegmentEditorText({
  segment,
  onChange,
  onConvertToSlide,
}: SegmentEditorTextProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const insertPlaceholder = (token: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange({ ...segment, text: `${segment.text}${token}` });
      return;
    }
    const start = ta.selectionStart ?? segment.text.length;
    const end = ta.selectionEnd ?? segment.text.length;
    const before = segment.text.slice(0, start);
    const after = segment.text.slice(end);
    const nextText = `${before}${token}${after}`;
    onChange({ ...segment, text: nextText });
    // Restore caret after token
    requestAnimationFrame(() => {
      const pos = start + token.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-5">
      {onConvertToSlide && (
        <div className="flex items-start gap-3 rounded-squircle-sm border border-brand/30 bg-brand-soft/60 p-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-deep" />
          <div className="flex-1 text-xs text-ink-soft">
            <strong className="text-ink">In freie Folie umwandeln</strong> —
            mehr Schriftarten, mehrere Layer, Bilder, Formen, Platzhalter
            überall. Diese Folie bleibt mit allen Inhalten erhalten.
          </div>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => onConvertToSlide(textSegmentToSlide(segment))}
            iconLeft={<Sparkles className="size-3.5" />}
          >
            Umwandeln
          </Button>
        </div>
      )}
      <div>
        <Label htmlFor={`text-${segment.id}`}>Text-Inhalt</Label>
        <Textarea
          id={`text-${segment.id}`}
          ref={textareaRef}
          value={segment.text}
          onChange={(e) => onChange({ ...segment, text: e.target.value })}
          rows={4}
          placeholder="Hallo {{firstName}}, ich habe etwas Spannendes für Sie ..."
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PLACEHOLDERS.map((p) => (
            <Button
              key={p.token}
              type="button"
              variant="subtle"
              size="sm"
              onClick={() => insertPlaceholder(p.token)}
            >
              {p.token}
            </Button>
          ))}
        </div>
      </div>

      <AdvancedSettings hint="Hintergrund- und Textfarbe">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Hintergrundfarbe</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={segment.bgColor}
              onChange={(e) => onChange({ ...segment, bgColor: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded-squircle-sm border border-line bg-surface"
              aria-label="Hintergrundfarbe wählen"
            />
            <span className="font-mono text-sm text-ink-soft">{segment.bgColor}</span>
          </div>
        </div>
        <div>
          <Label>Textfarbe</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={segment.textColor}
              onChange={(e) => onChange({ ...segment, textColor: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded-squircle-sm border border-line bg-surface"
              aria-label="Textfarbe wählen"
            />
            <span className="font-mono text-sm text-ink-soft">{segment.textColor}</span>
          </div>
        </div>
      </div>
      </AdvancedSettings>

      <div>
        <Label>
          Schriftgröße: <span className="text-ink font-mono normal-case">{segment.fontSize}px</span>
        </Label>
        <input
          type="range"
          min={24}
          max={128}
          step={1}
          value={segment.fontSize}
          onChange={(e) =>
            onChange({ ...segment, fontSize: parseInt(e.target.value, 10) })
          }
          className="w-full accent-brand"
        />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div>
          <Label>Ausrichtung</Label>
          <div className="inline-flex rounded-full border border-line bg-surface p-1">
            {(
              [
                { value: "left" as const, icon: AlignLeft, label: "Links" },
                { value: "center" as const, icon: AlignCenter, label: "Mitte" },
                { value: "right" as const, icon: AlignRight, label: "Rechts" },
              ]
            ).map(({ value, icon: Icon, label }) => {
              const active = segment.textAlign === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...segment, textAlign: value })}
                  aria-label={label}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-full transition-colors",
                    active
                      ? "bg-brand text-white"
                      : "text-ink-muted hover:bg-surface-muted",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Stil</Label>
          <div className="inline-flex gap-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...segment,
                  fontWeight: segment.fontWeight === "700" ? "400" : "700",
                })
              }
              aria-label="Fett"
              aria-pressed={segment.fontWeight === "700"}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full border transition-colors",
                segment.fontWeight === "700"
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
              )}
            >
              <Bold className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...segment, italic: !segment.italic })}
              aria-label="Kursiv"
              aria-pressed={segment.italic}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full border transition-colors",
                segment.italic
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
              )}
            >
              <Italic className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
