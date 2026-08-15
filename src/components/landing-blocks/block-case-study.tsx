import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import { resolveVariant } from "@/lib/landing-blocks/types";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

/* ------------------------------------------------------------------ */
/* Defensive narrowing of the persisted data shape                     */
/* ------------------------------------------------------------------ */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

interface CaseStudyClient {
  name: string;
  logoUrl: string;
  photoUrl: string;
}

function asClient(value: unknown): CaseStudyClient {
  const r = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    name: str(r.name),
    logoUrl: str(r.logoUrl),
    photoUrl: str(r.photoUrl),
  };
}

interface CaseStudyMedium {
  kind: "image" | "video";
  url: string;
  alt: string;
}

function asMedium(value: unknown): CaseStudyMedium {
  const r = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    kind: r.kind === "video" ? "video" : "image",
    url: str(r.url),
    alt: str(r.alt),
  };
}

type TextMode = "quote" | "free" | "structured" | "none";

function asTextMode(value: unknown): TextMode {
  return value === "free" || value === "structured" || value === "none"
    ? value
    : "quote";
}

interface CaseStudyQuote {
  text: string;
  author: string;
  role: string;
}

function asQuote(value: unknown): CaseStudyQuote {
  const r = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { text: str(r.text), author: str(r.author), role: str(r.role) };
}

interface CaseStudyStructured {
  situation: string;
  action: string;
  result: string;
  kpi: string;
}

function asStructured(value: unknown): CaseStudyStructured {
  const r = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    situation: str(r.situation),
    action: str(r.action),
    result: str(r.result),
    kpi: str(r.kpi),
  };
}

/* ------------------------------------------------------------------ */
/* Shared token styles                                                 */
/* ------------------------------------------------------------------ */

const MEDIA_STYLE: React.CSSProperties = {
  borderRadius: "var(--lp-radius-image)",
  boxShadow: "var(--lp-shadow-card)",
};

const LABEL_STYLE: React.CSSProperties = {
  color: "var(--lp-color-primary)",
};

/* ------------------------------------------------------------------ */
/* Sub-renderers                                                       */
/* ------------------------------------------------------------------ */

function MediumNode({ medium }: { medium: CaseStudyMedium }) {
  if (medium.kind === "video") {
    return (
      <video
        controls
        preload="metadata"
        playsInline
        src={medium.url}
        className="w-full"
        style={MEDIA_STYLE}
        aria-label={medium.alt || undefined}
      />
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={medium.url}
      alt={medium.alt}
      className="w-full object-cover"
      style={MEDIA_STYLE}
    />
  );
}

/** Dezente Absender-Zeile: Logo bevorzugt, sonst Kundenname als Text. */
function ClientLine({ client }: { client: CaseStudyClient }) {
  if (!client.logoUrl && !client.name) return null;
  return (
    <div className="flex items-center gap-3">
      {client.logoUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={client.logoUrl}
          alt={client.name}
          className="h-8 w-auto object-contain"
        />
      ) : (
        <span
          className="text-sm font-medium"
          style={{ color: "var(--lp-color-muted)" }}
        >
          {client.name}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block renderer                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fallstudie-Sektion (v3).
 *
 * Variante = Position des Mediums (media-left / media-right / media-top),
 * Textstufe (quote / free / structured / none) ist frei kombinierbar.
 * Konsumiert ausschliesslich Theme-Tokens — keine eigenen Grautöne, damit
 * dunkle Seiten gleichwertig funktionieren.
 */
export function BlockCaseStudy({
  data,
  style,
  variant,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const layout = resolveVariant("case-study", variant);
  const headline = renderPlaceholders(str(data.headline), leadData) ?? "";
  const client = asClient(data.client);
  const medium = asMedium(data.medium);
  const textMode = asTextMode(data.textMode);
  const quote = asQuote(data.quote);
  const freeText = renderPlaceholders(str(data.freeText), leadData) ?? "";
  const structured = asStructured(data.structured);

  const hasMedium = medium.url.length > 0;

  /* ---------- Text-Spalte je Textstufe -------------------------------- */

  let textNode: React.ReactNode = null;

  if (textMode === "quote") {
    const quoteText = renderPlaceholders(quote.text, leadData) ?? "";
    textNode = quoteText ? (
      <figure>
        <blockquote
          className="text-xl sm:text-2xl lg:text-3xl font-medium leading-snug text-balance"
          style={{ fontFamily: "var(--lp-font-body)" }}
        >
          &bdquo;{quoteText}&ldquo;
        </blockquote>
        {(quote.author || quote.role || client.photoUrl) && (
          <figcaption className="mt-6 flex items-center gap-3">
            {client.photoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={client.photoUrl}
                alt={quote.author || client.name}
                width={48}
                height={48}
                className="size-12 rounded-full object-cover"
              />
            )}
            <span className="text-sm sm:text-base">
              {quote.author && (
                <span className="block font-semibold">{quote.author}</span>
              )}
              {quote.role && (
                <span
                  className="block"
                  style={{ color: "var(--lp-color-muted)" }}
                >
                  {quote.role}
                </span>
              )}
            </span>
          </figcaption>
        )}
      </figure>
    ) : null;
  } else if (textMode === "free") {
    textNode =
      headline || freeText ? (
        <div>
          {headline && (
            <h2
              className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
              style={{ fontFamily: "var(--lp-font-heading)" }}
            >
              {headline}
            </h2>
          )}
          {freeText && (
            <p className="mt-4 text-base sm:text-lg leading-relaxed whitespace-pre-line">
              {freeText}
            </p>
          )}
        </div>
      ) : null;
  } else if (textMode === "structured") {
    const situation = renderPlaceholders(structured.situation, leadData) ?? "";
    const action = renderPlaceholders(structured.action, leadData) ?? "";
    const result = renderPlaceholders(structured.result, leadData) ?? "";
    const kpi = renderPlaceholders(structured.kpi, leadData) ?? "";
    const sections: Array<{ label: string; body: React.ReactNode }> = [];

    if (situation) {
      sections.push({
        label: "Ausgangslage",
        body: <p className="text-base leading-relaxed">{situation}</p>,
      });
    }
    if (action) {
      sections.push({
        label: "Was wir gemacht haben",
        body: <p className="text-base leading-relaxed">{action}</p>,
      });
    }
    if (result || kpi) {
      sections.push({
        label: "Ergebnis",
        body: (
          <div>
            {kpi && (
              <p
                className="text-4xl sm:text-5xl font-bold tracking-tight"
                style={{
                  color: "var(--lp-color-primary)",
                  fontFamily: "var(--lp-font-heading)",
                }}
              >
                {kpi}
              </p>
            )}
            {result && (
              <p className={cn("text-base leading-relaxed", kpi && "mt-2")}>
                {result}
              </p>
            )}
          </div>
        ),
      });
    }

    textNode =
      headline || sections.length > 0 ? (
        <div>
          {headline && (
            <h2
              className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
              style={{ fontFamily: "var(--lp-font-heading)" }}
            >
              {headline}
            </h2>
          )}
          {sections.length > 0 && (
            <dl className={cn("space-y-6", headline && "mt-8")}>
              {sections.map((section) => (
                <div key={section.label}>
                  <dt
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={LABEL_STYLE}
                  >
                    {section.label}
                  </dt>
                  <dd className="mt-2">{section.body}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null;
  } else {
    // "none": nur Medium + Kundenname/Logo. Die Absender-Zeile uebernimmt
    // hier die Text-Spalte (bzw. steht unter dem Medium bei media-top).
    textNode = <ClientLine client={client} />;
  }

  // Absender-Zeile zusaetzlich anzeigen, ausser bei "quote" (Autor steht
  // schon unter dem Zitat) und "none" (dort IST sie der Text-Inhalt).
  const showClientLine = textMode === "free" || textMode === "structured";

  const hasText = textNode !== null && !(textMode === "none" && !client.logoUrl && !client.name);
  if (!hasMedium && !hasText) return null;

  /* ---------- Layout --------------------------------------------------- */

  let body: React.ReactNode;

  if (!hasMedium) {
    body = (
      <div className="max-w-3xl">
        {textNode}
        {showClientLine && (
          <div className="mt-8">
            <ClientLine client={client} />
          </div>
        )}
      </div>
    );
  } else if (layout === "media-top") {
    body = (
      <div>
        <MediumNode medium={medium} />
        <div className="mt-8 sm:mt-10 max-w-3xl">
          {textNode}
          {showClientLine && (
            <div className="mt-8">
              <ClientLine client={client} />
            </div>
          )}
        </div>
      </div>
    );
  } else {
    // Zweispaltig ab Tablet, einspaltig auf dem Smartphone (Medium zuerst,
    // deshalb steht das Medium im DOM immer vorn und wandert per Order).
    const mediaOrder = layout === "media-right" ? "md:order-2" : "md:order-1";
    const textOrder = layout === "media-right" ? "md:order-1" : "md:order-2";
    body = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
        <div className={cn("min-w-0", mediaOrder)}>
          <MediumNode medium={medium} />
        </div>
        <div className={cn("min-w-0", textOrder)}>
          {textNode}
          {showClientLine && (
            <div className="mt-8">
              <ClientLine client={client} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "wide", alignment: "left" }}
    >
      {body}
    </BlockFrame>
  );
}
