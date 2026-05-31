"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import type { Block } from "@/lib/landing-blocks/types";
import { cn } from "@/lib/utils";

const SIZES: ReadonlyArray<{ key: "sm" | "md" | "lg" | "xl"; label: string; px: number }> = [
  { key: "sm", label: "Klein", px: 24 },
  { key: "md", label: "Mittel", px: 48 },
  { key: "lg", label: "Groß", px: 96 },
  { key: "xl", label: "Sehr groß", px: 144 },
];

export function BlockSpacerForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const current = (block.data.height ?? block.data.size) as
    | "sm" | "md" | "lg" | "xl"
    | undefined;
  return (
    <div className="space-y-2">
      <Label>Abstand</Label>
      <div className="grid grid-cols-2 gap-2">
        {SIZES.map((s) => {
          const active = current === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ height: s.key, size: s.key })}
              className={cn(
                "rounded-squircle-sm border px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              <div>{s.label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{s.px}px</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
