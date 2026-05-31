import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

interface TestimonialItem {
  quote: string;
  author?: string;
  role?: string;
  avatarUrl?: string;
}

function asItems(value: unknown): TestimonialItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): TestimonialItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const quote = typeof r.quote === "string" ? r.quote : "";
    if (!quote) return [];
    return [
      {
        quote,
        author: typeof r.author === "string" ? r.author : undefined,
        role: typeof r.role === "string" ? r.role : undefined,
        avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : undefined,
      },
    ];
  });
}

/**
 * Testimonials block — 1–3 column responsive grid of quote cards.
 *
 * data shape:
 *   { items: Array<{ quote; author?; role?; avatarUrl? }> }
 */
export function BlockTestimonials({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const items = asItems(data.items);
  if (items.length === 0) return null;

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "wide", alignment: "left" }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item, idx) => (
          <figure
            key={idx}
            className="rounded-2xl border border-line/30 p-5 bg-white/5"
          >
            <blockquote className="text-sm sm:text-base leading-relaxed">
              &ldquo;{renderPlaceholders(item.quote, leadData)}&rdquo;
            </blockquote>
            {(item.author || item.role || item.avatarUrl) && (
              <figcaption className="mt-4 flex items-center gap-3">
                {item.avatarUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.avatarUrl}
                    alt={item.author ?? ""}
                    width={36}
                    height={36}
                    className="size-9 rounded-full object-cover"
                  />
                )}
                <span className="text-sm">
                  {item.author && <span className="font-medium">{item.author}</span>}
                  {item.author && item.role && <span className="opacity-60"> · </span>}
                  {item.role && <span className="opacity-60">{item.role}</span>}
                </span>
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </BlockFrame>
  );
}
