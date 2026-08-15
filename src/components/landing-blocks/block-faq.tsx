import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import {
  resolveVariant,
  type BlockRenderProps,
  type LeadData,
} from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, MaybeEmptyField } from "./editable-text";

interface FaqItem {
  q: string;
  a: string;
  /** Index im gespeicherten items-Array — Basis fuer die Edit-Pfade
   *  ("items.<idx>.q"), auch wenn leere Fragen herausgefiltert werden. */
  idx: number;
}

function asItems(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, idx): FaqItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const q = typeof r.q === "string" ? r.q : "";
    const a = typeof r.a === "string" ? r.a : "";
    if (!q) return [];
    return [{ q, a, idx }];
  });
}

/**
 * Akkordeon-Liste — geteilt zwischen den Varianten "accordion" und
 * "two-column". Markup und Verhalten sind identisch zum v2-Bestand
 * (native <details>/<summary>, kein JS noetig).
 */
function FaqAccordion({
  items,
  leadData,
}: {
  items: FaqItem[];
  leadData: LeadData;
}) {
  return (
    /* Linien + Hover-Flaeche kommen aus dem Token-System: Border-Ton
       passt sich hell/dunkel an, die Hover-Flaeche nutzt den weichen
       Primaerfarb-Ton (--lp-color-primary-soft). Negative Margins +
       Padding halten den Text trotz Hover-Flaeche buendig. */
    <ul className="divide-y divide-[color:var(--lp-color-border)] border-y border-[color:var(--lp-color-border)]">
      {items.map((item, idx) => (
        <li key={idx}>
          <details className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium -mx-3 -my-2 px-3 py-2 transition-colors rounded-[var(--lp-radius-input)] hover:bg-[color:var(--lp-color-primary-soft)]">
              <span>
                <EditableText path={`items.${item.idx}.q`} raw={item.q}>
                  {renderPlaceholders(item.q, leadData)}
                </EditableText>
              </span>
              <span className="text-xl leading-none opacity-50 transition group-open:rotate-45">
                +
              </span>
            </summary>
            <MaybeEmptyField present={!!item.a}>
              <div className="mt-2 text-sm sm:text-base opacity-80 leading-relaxed whitespace-pre-line">
                <EditableText
                  path={`items.${item.idx}.a`}
                  raw={item.a}
                  multiline
                  emptyHint="Antwort eingeben"
                >
                  {renderPlaceholders(item.a, leadData)}
                </EditableText>
              </div>
            </MaybeEmptyField>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * FAQ block.
 *
 * Varianten (v3, siehe BLOCK_VARIANTS):
 *   - "accordion"  — einspaltiges Akkordeon (Default, wie v2).
 *   - "two-column" — Headline/Intro links, Akkordeon rechts; auf
 *                    Smartphone untereinander.
 *   - "open-list"  — alle Fragen ausgeklappt, kompakte Abstaende
 *                    (fuer 3-4 kurze FAQs).
 *
 * data shape:
 *   { items: Array<{ q; a }>;
 *     headline?: string; intro?: string }   // nur "two-column"
 */
export function BlockFaq({
  data,
  style,
  variant,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const items = asItems(data.items);
  if (items.length === 0) return null;

  const layout = resolveVariant("faq", variant);

  if (layout === "two-column") {
    const headline = renderPlaceholders(
      typeof data.headline === "string" ? data.headline : undefined,
      leadData,
    );
    const intro = renderPlaceholders(
      typeof data.intro === "string" ? data.intro : undefined,
      leadData,
    );
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "md", maxWidth: "wide", alignment: "left" }}
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[2fr_3fr] md:gap-12">
          <div>
            <MaybeEmptyField present={!!headline}>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
                style={{ fontFamily: "var(--lp-font-heading)" }}
              >
                <EditableText
                  path="headline"
                  raw={typeof data.headline === "string" ? data.headline : ""}
                  emptyHint="Überschrift eingeben"
                >
                  {headline}
                </EditableText>
              </h2>
            </MaybeEmptyField>
            <MaybeEmptyField present={!!intro}>
              <p className={headline ? "mt-3 text-base opacity-80" : "text-base opacity-80"}>
                <EditableText
                  path="intro"
                  raw={typeof data.intro === "string" ? data.intro : ""}
                  emptyHint="Einleitung eingeben"
                >
                  {intro}
                </EditableText>
              </p>
            </MaybeEmptyField>
          </div>
          <div>
            <FaqAccordion items={items} leadData={leadData} />
          </div>
        </div>
      </BlockFrame>
    );
  }

  if (layout === "open-list") {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
      >
        <ul className="divide-y divide-[color:var(--lp-color-border)] border-y border-[color:var(--lp-color-border)]">
          {items.map((item, idx) => (
            <li key={idx} className="py-3.5">
              <p className="text-base font-medium">
                <EditableText path={`items.${item.idx}.q`} raw={item.q}>
                  {renderPlaceholders(item.q, leadData)}
                </EditableText>
              </p>
              <MaybeEmptyField present={!!item.a}>
                <div className="mt-1.5 text-sm sm:text-base opacity-80 leading-relaxed whitespace-pre-line">
                  <EditableText
                    path={`items.${item.idx}.a`}
                    raw={item.a}
                    multiline
                    emptyHint="Antwort eingeben"
                  >
                    {renderPlaceholders(item.a, leadData)}
                  </EditableText>
                </div>
              </MaybeEmptyField>
            </li>
          ))}
        </ul>
      </BlockFrame>
    );
  }

  // Variante "accordion" — Bestandslayout, unveraendert.
  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
    >
      <FaqAccordion items={items} leadData={leadData} />
    </BlockFrame>
  );
}
