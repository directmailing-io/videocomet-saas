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
      {/* Linien + Hover-Flaeche kommen aus dem Token-System: Border-Ton
          passt sich hell/dunkel an, die Hover-Flaeche nutzt den weichen
          Primaerfarb-Ton (--lp-color-primary-soft). Negative Margins +
          Padding halten den Text trotz Hover-Flaeche buendig. */}
      <ul className="divide-y divide-[color:var(--lp-color-border)] border-y border-[color:var(--lp-color-border)]">
        {items.map((item, idx) => (
          <li key={idx}>
            <details className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium -mx-3 -my-2 px-3 py-2 transition-colors rounded-[var(--lp-radius-input)] hover:bg-[color:var(--lp-color-primary-soft)]">
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
