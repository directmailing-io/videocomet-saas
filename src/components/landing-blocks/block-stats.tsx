import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

interface StatItem {
  value: string;
  label: string;
}

function asStats(value: unknown): StatItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): StatItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const v = typeof r.value === "string" ? r.value : "";
    const l = typeof r.label === "string" ? r.label : "";
    if (!v && !l) return [];
    return [{ value: v, label: l }];
  });
}

/**
 * Stats block — 2-to-4 column grid of big numbers + labels. The column
 * count is derived from the item count so 3 stats render as 3 columns
 * on desktop without us asking the editor to pick.
 *
 * data shape:
 *   { items: Array<{ value; label }> }
 */
export function BlockStats({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const items = asStats(data.items);
  if (items.length === 0) return null;

  // Cap visible columns at 4. With more than 4 items we still grid them
  // as 4 columns; CSS handles the wrap.
  const cols = Math.min(items.length, 4);
  const colsClass = cn(
    "grid grid-cols-2 gap-6",
    cols >= 3 && "sm:grid-cols-3",
    cols >= 4 && "lg:grid-cols-4",
  );

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "wide", alignment: "center" }}
    >
      <dl className={colsClass}>
        {items.map((item, idx) => (
          <div key={idx}>
            <dt className="text-3xl sm:text-4xl font-bold tracking-tight">
              {renderPlaceholders(item.value, leadData)}
            </dt>
            <dd className="mt-1 text-sm opacity-70">
              {renderPlaceholders(item.label, leadData)}
            </dd>
          </div>
        ))}
      </dl>
    </BlockFrame>
  );
}
