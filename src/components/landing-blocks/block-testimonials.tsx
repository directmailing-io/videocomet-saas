"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import {
  resolveVariant,
  type BlockRenderProps,
  type LeadData,
} from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText } from "./editable-text";

interface TestimonialItem {
  quote: string;
  /** Index im gespeicherten items-Array — Basis fuer die Edit-Pfade
   *  ("items.<idx>.quote"), auch wenn leere Zitate gefiltert werden. */
  idx: number;
  author?: string;
  role?: string;
  avatarUrl?: string;
  /** Optionale Bewertung 1..5 — gefuellte Sterne ueber dem Zitat. */
  stars?: number;
}

function asItems(value: unknown): TestimonialItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, idx): TestimonialItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const quote = typeof r.quote === "string" ? r.quote : "";
    if (!quote) return [];
    const starsRaw = typeof r.stars === "number" ? Math.round(r.stars) : undefined;
    const stars =
      starsRaw !== undefined && starsRaw >= 1
        ? Math.min(starsRaw, 5)
        : undefined;
    return [
      {
        quote,
        idx,
        author: typeof r.author === "string" ? r.author : undefined,
        role: typeof r.role === "string" ? r.role : undefined,
        avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : undefined,
        stars,
      },
    ];
  });
}

/** Gefuellte Sterne in der Primaerfarbe (1..5). */
function Stars({ count }: { count: number }) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${count} von 5 Sternen`}
      style={{ color: "var(--lp-color-primary)" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="size-4"
        >
          <path d="M10 1.6l2.5 5.2 5.7.8-4.1 4 1 5.7L10 14.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8L10 1.6z" />
        </svg>
      ))}
    </div>
  );
}

function AuthorLine({ item }: { item: TestimonialItem }) {
  if (!item.author && !item.role) return null;
  return (
    <span className="text-sm">
      {item.author && (
        <span className="font-medium">
          <EditableText path={`items.${item.idx}.author`} raw={item.author}>
            {item.author}
          </EditableText>
        </span>
      )}
      {item.author && item.role && <span className="opacity-60"> · </span>}
      {item.role && (
        <span className="opacity-60">
          <EditableText path={`items.${item.idx}.role`} raw={item.role}>
            {item.role}
          </EditableText>
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Variante "spotlight" — ein Zitat gross, Pfeile zum Durchblaettern   */
/* ------------------------------------------------------------------ */

function SpotlightPager({
  items,
  leadData,
}: {
  items: TestimonialItem[];
  leadData: LeadData;
}) {
  const [index, setIndex] = React.useState(0);
  const item = items[Math.min(index, items.length - 1)];

  const arrowClass = cn(
    // size-11 = 44px — Mindest-Tap-Ziel aus der Responsive-Garantie.
    "flex size-11 items-center justify-center border transition-colors",
    "rounded-[var(--lp-radius-button)]",
    "bg-[color:var(--lp-color-surface)] hover:bg-[color:var(--lp-color-primary-soft)]",
  );
  const arrowStyle: React.CSSProperties = {
    color: "var(--lp-color-text)",
    borderColor: "var(--lp-color-border)",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div aria-live="polite">
        {item.stars && (
          <div className="mb-4 flex justify-center">
            <Stars count={item.stars} />
          </div>
        )}
        <blockquote
          className="text-xl sm:text-2xl font-medium leading-snug text-balance"
          style={{ fontFamily: "var(--lp-font-heading)" }}
        >
          &ldquo;
          <EditableText path={`items.${item.idx}.quote`} raw={item.quote}>
            {renderPlaceholders(item.quote, leadData)}
          </EditableText>
          &rdquo;
        </blockquote>
        {(item.author || item.role || item.avatarUrl) && (
          <div className="mt-5 flex items-center justify-center gap-3">
            {item.avatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={item.avatarUrl}
                alt={item.author ?? ""}
                width={40}
                height={40}
                className="size-10 rounded-full object-cover"
              />
            )}
            <AuthorLine item={item} />
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            type="button"
            className={arrowClass}
            style={arrowStyle}
            aria-label="Vorherige Kundenstimme"
            onClick={() =>
              setIndex((i) => (i - 1 + items.length) % items.length)
            }
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="size-5">
              <path
                d="M12.5 4.5L7 10l5.5 5.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="text-sm tabular-nums opacity-60">
            {Math.min(index, items.length - 1) + 1} / {items.length}
          </span>
          <button
            type="button"
            className={arrowClass}
            style={arrowStyle}
            aria-label="Nächste Kundenstimme"
            onClick={() => setIndex((i) => (i + 1) % items.length)}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="size-5">
              <path
                d="M7.5 4.5L13 10l-5.5 5.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Testimonials block.
 *
 * Varianten (v3, siehe BLOCK_VARIANTS):
 *   - "grid"      — 1-3-spaltiges Karten-Raster (Default, wie v2).
 *   - "spotlight" — ein Zitat gross und mittig, Pfeile zum Durchblaettern.
 *   - "list"      — kompakte Zeilen mit Avatar, fuer viele Stimmen.
 *
 * data shape:
 *   { items: Array<{ quote; author?; role?; avatarUrl?; stars? }> }
 */
export function BlockTestimonials({
  data,
  style,
  variant,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const items = asItems(data.items);
  if (items.length === 0) return null;

  const layout = resolveVariant("testimonials", variant);

  if (layout === "spotlight") {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "md", maxWidth: "normal", alignment: "center" }}
      >
        <SpotlightPager items={items} leadData={leadData} />
      </BlockFrame>
    );
  }

  if (layout === "list") {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
      >
        <ul className="divide-y divide-[color:var(--lp-color-border)]">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-4 py-4">
              {item.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.avatarUrl}
                  alt={item.author ?? ""}
                  width={40}
                  height={40}
                  className="size-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold"
                  style={{
                    backgroundColor: "var(--lp-color-surface)",
                    borderColor: "var(--lp-color-border)",
                    color: "var(--lp-color-primary)",
                  }}
                >
                  {(item.author ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <blockquote className="text-sm sm:text-base leading-relaxed">
                  &ldquo;
                  <EditableText path={`items.${item.idx}.quote`} raw={item.quote}>
                    {renderPlaceholders(item.quote, leadData)}
                  </EditableText>
                  &rdquo;
                </blockquote>
                <div className="mt-1.5">
                  <AuthorLine item={item} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </BlockFrame>
    );
  }

  // Variante "grid" — Bestandslayout; NEU ist nur der optionale
  // Sterne-Block oberhalb des Zitats (Bestandsdaten haben kein `stars`).
  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "wide", alignment: "left" }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item, idx) => (
          <figure
            key={idx}
            className="p-5"
            style={{
              backgroundColor: "var(--lp-color-surface)",
              border: "1px solid var(--lp-color-border)",
              borderRadius: "var(--lp-radius-card)",
              boxShadow: "var(--lp-shadow-card)",
            }}
          >
            {item.stars && (
              <div className="mb-3">
                <Stars count={item.stars} />
              </div>
            )}
            <blockquote className="text-sm sm:text-base leading-relaxed">
              &ldquo;
              <EditableText path={`items.${item.idx}.quote`} raw={item.quote}>
                {renderPlaceholders(item.quote, leadData)}
              </EditableText>
              &rdquo;
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
                <AuthorLine item={item} />
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </BlockFrame>
  );
}
