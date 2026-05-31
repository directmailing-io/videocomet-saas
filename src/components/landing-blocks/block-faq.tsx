import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

interface FaqItem {
  q: string;
  a: string;
}

function asItems(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): FaqItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const q = typeof r.q === "string" ? r.q : "";
    const a = typeof r.a === "string" ? r.a : "";
    if (!q) return [];
    return [{ q, a }];
  });
}

/**
 * FAQ block — native <details>/<summary> accordion. No JS required;
 * works offline + with progressive enhancement.
 *
 * data shape:
 *   { items: Array<{ q; a }> }
 */
export function BlockFaq({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const items = asItems(data.items);
  if (items.length === 0) return null;

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
    >
      <ul className="divide-y divide-line/30 border-y border-line/30">
        {items.map((item, idx) => (
          <li key={idx}>
            <details className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium">
                <span>{renderPlaceholders(item.q, leadData)}</span>
                <span className="text-xl leading-none opacity-50 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              {item.a && (
                <div className="mt-2 text-sm sm:text-base opacity-80 leading-relaxed whitespace-pre-line">
                  {renderPlaceholders(item.a, leadData)}
                </div>
              )}
            </details>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}
