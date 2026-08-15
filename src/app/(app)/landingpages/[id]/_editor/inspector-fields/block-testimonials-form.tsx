"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";

import { asArray, asString, MediaUrlField, Repeater } from "./shared";

interface TestimonialItem {
  quote?: string;
  author?: string;
  role?: string;
  avatar?: string;
  /** 0 oder leer = keine Sterne anzeigen. */
  stars?: number;
}

export function BlockTestimonialsForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const items = asArray<TestimonialItem>(block.data.items);
  return (
    <Repeater<TestimonialItem>
      label="Testimonials"
      items={items}
      onChange={(next) => onChange({ items: next })}
      makeEmpty={() => ({ quote: "", author: "", role: "", avatar: "" })}
      renderItem={(item, update) => (
        <div className="space-y-2">
          <div>
            <Label>Zitat</Label>
            <Textarea
              value={asString(item.quote)}
              onChange={(e) => update({ quote: e.target.value })}
              rows={2}
              placeholder="Was hat die Person über Sie gesagt?"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Name</Label>
              <Input
                value={asString(item.author)}
                onChange={(e) => update({ author: e.target.value })}
                placeholder="Anna Schmidt"
              />
            </div>
            <div>
              <Label>Rolle</Label>
              <Input
                value={asString(item.role)}
                onChange={(e) => update({ role: e.target.value })}
                placeholder="CEO Beispiel GmbH"
              />
            </div>
          </div>
          <MediaUrlField
            label="Avatar (optional)"
            value={asString(item.avatar)}
            onChange={(url) => update({ avatar: url })}
            type="image"
          />
          <div>
            <Label>Sterne (0 bis 5, optional)</Label>
            <Input
              type="number"
              min={0}
              max={5}
              step={1}
              value={
                typeof item.stars === "number" && item.stars > 0
                  ? String(item.stars)
                  : ""
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  update({ stars: undefined });
                  return;
                }
                const n = Math.round(Number(raw));
                update({
                  stars: Number.isFinite(n)
                    ? Math.max(0, Math.min(5, n))
                    : undefined,
                });
              }}
              placeholder="Leer = keine Sterne"
            />
          </div>
        </div>
      )}
    />
  );
}
