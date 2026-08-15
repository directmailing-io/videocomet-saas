import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import { resolveVariant } from "@/lib/landing-blocks/types";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, EditSwitch, MaybeEmptyField } from "./editable-text";
import { ImagePlaceholder } from "./image-placeholder";

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
  if (!medium.url) {
    // Nur im Builder sichtbar (Public rendert diesen Zweig nie mit
    // leerer URL bzw. ImagePlaceholder ergibt dort null).
    return <ImagePlaceholder />;
  }
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

  // Editierbare Ueberschrift — in "free" und "structured" identisch.
  const rawHeadline = str(data.headline);
  const headlineNode = (
    <MaybeEmptyField present={!!headline}>
      <h2
        className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
        style={{ fontFamily: "var(--lp-font-heading)" }}
      >
        <EditableText
          path="headline"
          raw={rawHeadline}
          emptyHint="Überschrift eingeben"
        >
          {headline}
        </EditableText>
      </h2>
    </MaybeEmptyField>
  );

  let textNode: React.ReactNode = null;
  // Praesenz getrennt vom Node halten: im Edit-Modus rendern
  // MaybeEmptyField-Felder auch leere Inhalte, der Public-Pfad braucht
  // aber weiterhin die "gibt es Text?"-Entscheidung von frueher.
  let textPresent = false;

  if (textMode === "quote") {
    const quoteText = renderPlaceholders(quote.text, leadData) ?? "";
    textPresent = !!quoteText;
    textNode = (
      <MaybeEmptyField present={!!quoteText}>
        <figure>
          <blockquote
            className="text-xl sm:text-2xl lg:text-3xl font-medium leading-snug text-balance"
            style={{ fontFamily: "var(--lp-font-body)" }}
          >
            &bdquo;
            <EditableText
              path="quote.text"
              raw={quote.text}
              emptyHint="Zitat eingeben"
            >
              {quoteText}
            </EditableText>
            &ldquo;
          </blockquote>
          <MaybeEmptyField
            present={!!(quote.author || quote.role || client.photoUrl)}
          >
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
                <MaybeEmptyField present={!!quote.author}>
                  <span className="block font-semibold">
                    <EditableText
                      path="quote.author"
                      raw={quote.author}
                      emptyHint="Name eingeben"
                    >
                      {quote.author}
                    </EditableText>
                  </span>
                </MaybeEmptyField>
                <MaybeEmptyField present={!!quote.role}>
                  <span
                    className="block"
                    style={{ color: "var(--lp-color-muted)" }}
                  >
                    <EditableText
                      path="quote.role"
                      raw={quote.role}
                      emptyHint="Rolle eingeben"
                    >
                      {quote.role}
                    </EditableText>
                  </span>
                </MaybeEmptyField>
              </span>
            </figcaption>
          </MaybeEmptyField>
        </figure>
      </MaybeEmptyField>
    );
  } else if (textMode === "free") {
    textPresent = !!(headline || freeText);
    textNode = (
      <MaybeEmptyField present={textPresent}>
        <div>
          {headlineNode}
          <MaybeEmptyField present={!!freeText}>
            <p className="mt-4 text-base sm:text-lg leading-relaxed whitespace-pre-line">
              <EditableText
                path="freeText"
                raw={str(data.freeText)}
                multiline
                emptyHint="Text eingeben"
              >
                {freeText}
              </EditableText>
            </p>
          </MaybeEmptyField>
        </div>
      </MaybeEmptyField>
    );
  } else if (textMode === "structured") {
    const situation = renderPlaceholders(structured.situation, leadData) ?? "";
    const action = renderPlaceholders(structured.action, leadData) ?? "";
    const result = renderPlaceholders(structured.result, leadData) ?? "";
    const kpi = renderPlaceholders(structured.kpi, leadData) ?? "";

    const sections: Array<{
      label: string;
      present: boolean;
      body: React.ReactNode;
    }> = [
      {
        label: "Ausgangslage",
        present: !!situation,
        body: (
          <p className="text-base leading-relaxed">
            <EditableText
              path="structured.situation"
              raw={structured.situation}
              emptyHint="Ausgangslage beschreiben"
            >
              {situation}
            </EditableText>
          </p>
        ),
      },
      {
        label: "Was wir gemacht haben",
        present: !!action,
        body: (
          <p className="text-base leading-relaxed">
            <EditableText
              path="structured.action"
              raw={structured.action}
              emptyHint="Vorgehen beschreiben"
            >
              {action}
            </EditableText>
          </p>
        ),
      },
      {
        label: "Ergebnis",
        present: !!(result || kpi),
        body: (
          <div>
            <MaybeEmptyField present={!!kpi}>
              <p
                className="text-4xl sm:text-5xl font-bold tracking-tight"
                style={{
                  color: "var(--lp-color-primary)",
                  fontFamily: "var(--lp-font-heading)",
                }}
              >
                <EditableText
                  path="structured.kpi"
                  raw={structured.kpi}
                  emptyHint="Kennzahl"
                >
                  {kpi}
                </EditableText>
              </p>
            </MaybeEmptyField>
            <MaybeEmptyField present={!!result}>
              <p className={cn("text-base leading-relaxed", kpi && "mt-2")}>
                <EditableText
                  path="structured.result"
                  raw={structured.result}
                  emptyHint="Ergebnis beschreiben"
                >
                  {result}
                </EditableText>
              </p>
            </MaybeEmptyField>
          </div>
        ),
      },
    ];
    const anySection = sections.some((section) => section.present);

    textPresent = !!headline || anySection;
    textNode = (
      <MaybeEmptyField present={textPresent}>
        <div>
          {headlineNode}
          <MaybeEmptyField present={anySection}>
            <dl className={cn("space-y-6", headline && "mt-8")}>
              {sections.map((section) => (
                <MaybeEmptyField key={section.label} present={section.present}>
                  <div>
                    <dt
                      className="text-xs font-semibold uppercase tracking-widest"
                      style={LABEL_STYLE}
                    >
                      {section.label}
                    </dt>
                    <dd className="mt-2">{section.body}</dd>
                  </div>
                </MaybeEmptyField>
              ))}
            </dl>
          </MaybeEmptyField>
        </div>
      </MaybeEmptyField>
    );
  } else {
    // "none": nur Medium + Kundenname/Logo. Die Absender-Zeile uebernimmt
    // hier die Text-Spalte (bzw. steht unter dem Medium bei media-top).
    textNode = <ClientLine client={client} />;
    textPresent = !!(client.logoUrl || client.name);
  }

  // Absender-Zeile zusaetzlich anzeigen, ausser bei "quote" (Autor steht
  // schon unter dem Zitat) und "none" (dort IST sie der Text-Inhalt).
  const showClientLine = textMode === "free" || textMode === "structured";

  const hasText = textPresent;

  /* ---------- Layout --------------------------------------------------- */

  const textWithClient = (
    <>
      {textNode}
      {showClientLine && (
        <div className="mt-8">
          <ClientLine client={client} />
        </div>
      )}
    </>
  );

  const textOnlyBody = <div className="max-w-3xl">{textWithClient}</div>;

  let mediaBody: React.ReactNode;
  if (layout === "media-top") {
    mediaBody = (
      <div>
        <MediumNode medium={medium} />
        <div className="mt-8 sm:mt-10 max-w-3xl">{textWithClient}</div>
      </div>
    );
  } else {
    // Zweispaltig ab Tablet, einspaltig auf dem Smartphone (Medium zuerst,
    // deshalb steht das Medium im DOM immer vorn und wandert per Order).
    const mediaOrder = layout === "media-right" ? "md:order-2" : "md:order-1";
    const textOrder = layout === "media-right" ? "md:order-1" : "md:order-2";
    mediaBody = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
        <div className={cn("min-w-0", mediaOrder)}>
          <MediumNode medium={medium} />
        </div>
        <div className={cn("min-w-0", textOrder)}>{textWithClient}</div>
      </div>
    );
  }

  // Ohne Medium: Public rendert (wie bisher) die reine Text-Spalte,
  // der Builder zeigt das Medien-Layout mit Bild-Platzhalter.
  const body: React.ReactNode = hasMedium ? (
    mediaBody
  ) : (
    <EditSwitch editing={mediaBody} fallback={textOnlyBody} />
  );

  const frame = (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "wide", alignment: "left" }}
    >
      {body}
    </BlockFrame>
  );

  if (!hasMedium && !hasText) {
    // Public: unveraendert null. Im Builder: leere Felder mit Hint
    // rendern, damit der Block anklickbar bleibt.
    return <MaybeEmptyField present={false}>{frame}</MaybeEmptyField>;
  }
  return frame;
}
