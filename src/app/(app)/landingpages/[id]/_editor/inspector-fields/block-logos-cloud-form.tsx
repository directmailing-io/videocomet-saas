"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Block } from "@/lib/landing-blocks/types";

import { asArray, asString, MediaUrlField, Repeater } from "./shared";

interface LogoItem {
  url?: string;
  alt?: string;
  href?: string;
}

export function BlockLogosCloudForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  const items = asArray<LogoItem>(data.items);
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="logos-title">Überschrift</Label>
        <Input
          id="logos-title"
          value={asString(data.title)}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Vertraut von"
        />
      </div>
      <Repeater<LogoItem>
        label="Logos"
        items={items}
        onChange={(next) => onChange({ items: next })}
        makeEmpty={() => ({ url: "", alt: "", href: "" })}
        renderItem={(item, update) => (
          <div className="space-y-2">
            <MediaUrlField
              label="Logo"
              value={asString(item.url)}
              onChange={(url) => update({ url })}
              type="logo"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Alt-Text</Label>
                <Input
                  value={asString(item.alt)}
                  onChange={(e) => update({ alt: e.target.value })}
                  placeholder="Firmenname"
                />
              </div>
              <div>
                <Label>Link (optional)</Label>
                <Input
                  value={asString(item.href)}
                  onChange={(e) => update({ href: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
