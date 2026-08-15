"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  detectBookingLink,
  type BookingProvider,
} from "@/lib/booking-link";
import {
  asFormFields,
  DEFAULT_FORM_FIELDS,
  MAX_FORM_FIELDS,
  type LpFormFieldDef,
  type LpFormFieldType,
} from "@/lib/landing-blocks/form-fields";
import { resolveVariant, type Block } from "@/lib/landing-blocks/types";
import { Switch } from "@/components/ui/switch";
import { asObject, asString, Repeater } from "./shared";

const PROVIDER_NAMES: Record<Exclude<BookingProvider, "unknown">, string> = {
  calendly: "Calendly",
  "cal-com": "Cal.com",
  "ms-bookings": "Microsoft Bookings",
  google: "Google Terminplan",
  hubspot: "HubSpot",
  tidycal: "TidyCal",
};

export function BlockCtaBannerForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  const primary = asObject(data.primaryButton);
  const secondary = asObject(data.secondaryButton);
  const variant = resolveVariant("cta-banner", block.variant);
  const isCalendar =
    variant === "calendar-inline" || variant === "calendar-popup";
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cta-head">Headline</Label>
        <Input
          id="cta-head"
          value={asString(data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Bereit für den nächsten Schritt?"
        />
      </div>
      <div>
        <Label htmlFor="cta-sub">Subheadline (optional)</Label>
        <Textarea
          id="cta-sub"
          value={asString(data.subheadline)}
          onChange={(e) => onChange({ subheadline: e.target.value })}
          rows={2}
          placeholder="Eine kurze Einladung in 1 Satz."
        />
      </div>
      {isCalendar && (
        <div>
          <Label htmlFor="cta-booking-url">Buchungslink</Label>
          <Input
            id="cta-booking-url"
            value={asString(data.bookingUrl)}
            onChange={(e) => onChange({ bookingUrl: e.target.value })}
            placeholder="https://calendly.com/dein-name"
          />
          <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
            Calendly, Cal.com, Microsoft Bookings, Google Terminplan,
            HubSpot oder TidyCal. Wir betten automatisch richtig ein.
          </p>
          <BookingDetectHint url={asString(data.bookingUrl)} />
        </div>
      )}
      {variant === "form" && (
        <>
          <p className="text-[11px] text-ink-muted leading-relaxed rounded-squircle-sm bg-surface-soft border border-line px-3 py-2">
            Anfragen landen in deinem CRM am Kontakt und du bekommst eine
            E-Mail. Name und E-Mail sind immer dabei, weitere Felder
            bestimmst du selbst.
          </p>
          <FormFieldsEditor
            fields={asFormFields(data.formFields) ?? DEFAULT_FORM_FIELDS}
            onChange={(fields) => onChange({ formFields: fields })}
          />
        </>
      )}
      <ButtonFieldset
        title="Primärer Button"
        label={asString(primary.label)}
        url={asString(primary.url)}
        onChange={(label, url) =>
          onChange({ primaryButton: { label, url } })
        }
      />
      <SecondaryButtonDisclosure
        label={asString(secondary.label)}
        url={asString(secondary.url)}
        onChange={(label, url) =>
          onChange({ secondaryButton: { label, url } })
        }
      />
    </div>
  );
}

/** Zweiter Button erst auf Klick — hält das Panel im Normalfall schlank. */
function SecondaryButtonDisclosure({
  label,
  url,
  onChange,
}: {
  label: string;
  url: string;
  onChange: (label: string, url: string) => void;
}) {
  const hasContent = !!(label || url);
  const [open, setOpen] = React.useState(hasContent);
  if (!open && !hasContent) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-brand-deep hover:underline"
      >
        + Zweiten Button hinzufügen
      </button>
    );
  }
  return (
    <div className="space-y-1.5">
      <ButtonFieldset
        title="Zweiter Button"
        label={label}
        url={url}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => {
          onChange("", "");
          setOpen(false);
        }}
        className="text-xs font-medium text-danger hover:opacity-80"
      >
        Zweiten Button entfernen
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formular-Baukasten (Variante "form")                                */
/* ------------------------------------------------------------------ */

const FIELD_TYPE_LABELS: Record<LpFormFieldType, string> = {
  text: "Text (eine Zeile)",
  email: "E-Mail",
  tel: "Telefon",
  textarea: "Text (mehrzeilig)",
};

function makeFieldId(): string {
  return "f" + Math.random().toString(36).slice(2, 10);
}

function FormFieldsEditor({
  fields,
  onChange,
}: {
  fields: LpFormFieldDef[];
  onChange: (fields: LpFormFieldDef[]) => void;
}) {
  return (
    <Repeater<LpFormFieldDef>
      label="Formularfelder"
      items={fields.slice(0, MAX_FORM_FIELDS)}
      onChange={onChange}
      makeEmpty={() => ({
        id: makeFieldId(),
        label: "",
        type: "text",
        required: false,
      })}
      preview={(f) => f.label || FIELD_TYPE_LABELS[f.type]}
      renderItem={(f, update) => (
        <>
          <div>
            <Label>Beschriftung</Label>
            <Input
              value={f.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="z. B. Firma"
            />
          </div>
          <div>
            <Label>Feldtyp</Label>
            <select
              value={f.type}
              onChange={(e) =>
                update({ type: e.target.value as LpFormFieldType })
              }
              className="w-full rounded-squircle-sm border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
            >
              {(Object.keys(FIELD_TYPE_LABELS) as LpFormFieldType[]).map(
                (t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="mb-0">Pflichtfeld</Label>
            <Switch
              checked={f.required}
              onCheckedChange={(c) => update({ required: c })}
            />
          </div>
          <div>
            <Label>Vorbefüllen aus Lead-Spalte (optional)</Label>
            <Input
              value={f.prefillKey ?? ""}
              onChange={(e) =>
                update({ prefillKey: e.target.value || undefined })
              }
              placeholder="z. B. firma"
            />
            <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
              Name der Spalte aus deiner Lead-Liste. Das Feld ist dann für
              jeden Empfänger schon ausgefüllt.
            </p>
          </div>
        </>
      )}
    />
  );
}

/** Live-Feedback unter dem Buchungslink: erkannter Anbieter oder Fallback-Hinweis. */
function BookingDetectHint({ url }: { url: string }) {
  const trimmed = url.trim();
  if (!trimmed) return <></>;
  const info = detectBookingLink(trimmed);
  if (info.provider === "unknown") {
    return (
      <p className="text-[11px] text-warn mt-1 leading-relaxed">
        Unbekannter Anbieter: Der Button öffnet den Link direkt.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-ok mt-1 leading-relaxed">
      Erkannt: {PROVIDER_NAMES[info.provider]}
    </p>
  );
}

function ButtonFieldset({
  title,
  label,
  url,
  onChange,
}: {
  title: string;
  label: string;
  url: string;
  onChange: (label: string, url: string) => void;
}) {
  return (
    <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </legend>
      <div>
        <Label>Beschriftung</Label>
        <Input
          value={label}
          onChange={(e) => onChange(e.target.value, url)}
          placeholder="Termin buchen"
        />
      </div>
      <div>
        <Label>Link</Label>
        <Input
          value={url}
          onChange={(e) => onChange(label, e.target.value)}
          placeholder="https://calendly.com/…"
        />
      </div>
    </fieldset>
  );
}
