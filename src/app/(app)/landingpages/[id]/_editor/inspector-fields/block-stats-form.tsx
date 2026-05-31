"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Block } from "@/lib/landing-blocks/types";
import { asArray, asString, Repeater } from "./shared";

interface StatItem {
  value?: string;
  label?: string;
}

export function BlockStatsForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const items = asArray<StatItem>(block.data.items);
  return (
    <Repeater<StatItem>
      label="Kennzahlen"
      items={items}
      onChange={(next) => onChange({ items: next })}
      makeEmpty={() => ({ value: "", label: "" })}
      renderItem={(item, update) => (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Zahl</Label>
            <Input
              value={asString(item.value)}
              onChange={(e) => update({ value: e.target.value })}
              placeholder="200+"
            />
          </div>
          <div>
            <Label>Bezeichnung</Label>
            <Input
              value={asString(item.label)}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="Kunden"
            />
          </div>
        </div>
      )}
    />
  );
}
