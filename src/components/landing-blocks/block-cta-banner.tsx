import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import { resolveVariant } from "@/lib/landing-blocks/types";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import {
  bookingPrefillFromLead,
  detectBookingLink,
} from "@/lib/booking-link";
import { BlockFrame } from "./block-frame";
import { CtaButton } from "./cta-button";
import { EditableText, MaybeEmptyField } from "./editable-text";
import { BookingInline, BookingPopupButton } from "./booking-embed";
import { LpFormCta } from "./lp-form-cta";

interface CtaConfig {
  label?: string;
  url?: string;
}

function asCta(value: unknown): CtaConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  if (!label || !url) return undefined;
  return { label, url };
}

/** Sicherheitsregel: als Fallback-Link nur http(s)-URLs zulassen. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

const DEFAULT_BOOKING_LABEL = "Termin buchen";

/**
 * CTA-Banner block — prominent call-to-action surface with headline,
 * optional subheadline and up to two buttons. Tracking is delegated to
 * the shared `<CtaButton>` so click events match the rest of the page.
 *
 * v3-Varianten (Konzept 5.6):
 *   - "button"          — heutiges Rendering, unveraendert (Default).
 *   - "calendar-inline" — Headline links, eingebetteter Buchungskalender
 *                         rechts (universeller Detektor, `booking-link.ts`).
 *   - "calendar-popup"  — wie "button", Klick oeffnet den Kalender als Overlay.
 *   - "form"            — kurzes Kontaktformular fuer User ohne Buchungstool.
 *
 * data shape:
 *   { headline; subheadline?;
 *     primaryButton?:{label,url}; secondaryButton?:{label,url};
 *     bookingUrl? }
 *
 * `bookingUrl` ist EIN Feld fuer alle Anbieter (Calendly, Cal.com,
 * MS Bookings, Google, HubSpot, TidyCal). Nicht embedbare oder leere
 * Links fallen sauber auf die Button-Darstellung zurueck.
 */
export function BlockCtaBanner({
  data,
  style,
  variant,
  leadData,
  leadId,
}: BlockRenderProps): React.ReactElement | null {
  const resolved = resolveVariant("cta-banner", variant);
  const headline = renderPlaceholders(
    typeof data.headline === "string" ? data.headline : undefined,
    leadData,
  );
  const subheadline = renderPlaceholders(
    typeof data.subheadline === "string" ? data.subheadline : undefined,
    leadData,
  );
  const primary = asCta(data.primaryButton);
  const secondary = asCta(data.secondaryButton);

  // Unaufgeloeste Rohtexte fuer die Inline-Bearbeitung im Builder.
  const rawHeadline = typeof data.headline === "string" ? data.headline : "";
  const rawSubheadline =
    typeof data.subheadline === "string" ? data.subheadline : "";

  // Headline/Unterzeile sind in allen Varianten identisch aufgebaut —
  // einmal zentral zusammensetzen (inkl. Leer-Zustand im Edit-Modus).
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
  const subheadlineNode = (
    <MaybeEmptyField present={!!subheadline}>
      <p className="mt-3 text-base sm:text-lg opacity-80">
        <EditableText
          path="subheadline"
          raw={rawSubheadline}
          emptyHint="Unterzeile eingeben"
        >
          {subheadline}
        </EditableText>
      </p>
    </MaybeEmptyField>
  );

  /** Editierbares Label eines Buttons (Punkt-Pfad in die Button-Config). */
  const editableLabel = (
    pathPrefix: string,
    rawLabel: string,
    resolvedLabel: React.ReactNode,
  ) => (
    <EditableText path={`${pathPrefix}.label`} raw={rawLabel}>
      {resolvedLabel}
    </EditableText>
  );

  // Buttons konsumieren ausschliesslich Theme-Tokens: Radius/Schatten/
  // Textfarbe als Inline-Style, Hintergrund + Hover als Tailwind-
  // Arbitrary-Klassen (Hover geht nicht per Inline-Style, und ein
  // Inline-Background wuerde die Hover-Klasse ueberdecken).
  const btnClass = cn(
    "inline-flex items-center justify-center px-7 py-3.5",
    "text-sm font-semibold transition-all duration-150",
    "rounded-[var(--lp-radius-button)]",
  );
  const primaryBtnClass = cn(
    btnClass,
    "bg-[color:var(--lp-color-primary)] hover:bg-[color:var(--lp-color-primary-hover)]",
  );
  const primaryStyle: React.CSSProperties = {
    color: "var(--lp-color-on-primary)",
    boxShadow: "var(--lp-shadow-cta)",
  };
  const secondaryStyle: React.CSSProperties = {
    color: "var(--lp-color-text)",
    borderColor: "var(--lp-color-border)",
  };

  const bookingUrl =
    typeof data.bookingUrl === "string" ? data.bookingUrl.trim() : "";
  const booking = detectBookingLink(
    bookingUrl,
    bookingPrefillFromLead(leadData),
  );
  const bookingLabel =
    (primary?.label && renderPlaceholders(primary.label, leadData)) ||
    primary?.label ||
    DEFAULT_BOOKING_LABEL;

  /* ---------------------------------------------------------------- */
  /* Variante: Formular                                                */
  /* ---------------------------------------------------------------- */

  if (resolved === "form") {
    const prefill = bookingPrefillFromLead(leadData);
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "lg", maxWidth: "normal", alignment: "center" }}
      >
        {headlineNode}
        {subheadlineNode}
        <div className={headline || subheadline ? "mt-8" : undefined}>
          <LpFormCta
            leadId={leadId}
            defaultName={prefill.name}
            defaultEmail={prefill.email}
          />
        </div>
      </BlockFrame>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Variante: Kalender inline                                          */
  /* ---------------------------------------------------------------- */

  if (resolved === "calendar-inline" && booking.canEmbed && booking.embedUrl) {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "lg", maxWidth: "wide", alignment: "left" }}
      >
        <div
          className="grid gap-8 p-6 sm:p-10 md:grid-cols-2 md:items-center"
          style={{
            background: "var(--lp-color-primary-soft)",
            borderRadius: "var(--lp-radius-card)",
          }}
        >
          <div>
            {headlineNode}
            {subheadlineNode}
          </div>
          <BookingInline
            embedUrl={booking.embedUrl}
            provider={booking.provider}
            popupLabel={bookingLabel}
            buttonClassName={primaryBtnClass}
            buttonStyle={primaryStyle}
          />
        </div>
      </BlockFrame>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Variante: Kalender-Popup                                          */
  /* ---------------------------------------------------------------- */

  if (resolved === "calendar-popup" && booking.canEmbed && booking.embedUrl) {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "lg", maxWidth: "normal", alignment: "center" }}
      >
        {headlineNode}
        {subheadlineNode}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <BookingPopupButton
            embedUrl={booking.embedUrl}
            provider={booking.provider}
            label={bookingLabel}
            className={primaryBtnClass}
            style={primaryStyle}
          />
          {secondary && secondary.label && secondary.url && (
            <CtaButton
              leadId={leadId}
              label={renderPlaceholders(secondary.label, leadData) || secondary.label}
              href={renderPlaceholders(secondary.url, leadData) || secondary.url}
              position="secondary"
              className={cn(
                btnClass,
                "border bg-[color:var(--lp-color-surface)] hover:bg-[color:var(--lp-color-primary-soft)]",
              )}
              style={secondaryStyle}
            >
              {editableLabel(
                "secondaryButton",
                secondary.label,
                renderPlaceholders(secondary.label, leadData) || secondary.label,
              )}
            </CtaButton>
          )}
        </div>
      </BlockFrame>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Variante: Button (Default) + Fallback der Kalender-Varianten       */
  /* ---------------------------------------------------------------- */

  // Kalender-Variante ohne embedbaren Link: Button oeffnet den
  // Buchungslink in neuem Tab (sofern http(s)), sonst normaler Button.
  const isCalendarFallback = resolved !== "button";
  const effectivePrimary: CtaConfig | undefined =
    isCalendarFallback && bookingUrl && isHttpUrl(bookingUrl)
      ? { label: primary?.label ?? DEFAULT_BOOKING_LABEL, url: bookingUrl }
      : primary;

  if (!headline && !effectivePrimary && !secondary) return null;

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "normal", alignment: "center" }}
    >
      {headlineNode}
      {subheadlineNode}
      {(effectivePrimary || secondary) && (
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {effectivePrimary && effectivePrimary.label && effectivePrimary.url && (
            <CtaButton
              leadId={leadId}
              label={
                renderPlaceholders(effectivePrimary.label, leadData) ||
                effectivePrimary.label
              }
              href={
                renderPlaceholders(effectivePrimary.url, leadData) ||
                effectivePrimary.url
              }
              position="primary"
              className={primaryBtnClass}
              style={primaryStyle}
            >
              {editableLabel(
                "primaryButton",
                primary?.label ?? "",
                renderPlaceholders(effectivePrimary.label, leadData) ||
                  effectivePrimary.label,
              )}
            </CtaButton>
          )}
          {secondary && secondary.label && secondary.url && (
            <CtaButton
              leadId={leadId}
              label={renderPlaceholders(secondary.label, leadData) || secondary.label}
              href={renderPlaceholders(secondary.url, leadData) || secondary.url}
              position="secondary"
              className={cn(
                btnClass,
                "border bg-[color:var(--lp-color-surface)] hover:bg-[color:var(--lp-color-primary-soft)]",
              )}
              style={secondaryStyle}
            >
              {editableLabel(
                "secondaryButton",
                secondary.label,
                renderPlaceholders(secondary.label, leadData) || secondary.label,
              )}
            </CtaButton>
          )}
        </div>
      )}
    </BlockFrame>
  );
}
