"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/tracker";
import {
  prefillValue,
  type LpFormFieldDef,
} from "@/lib/landing-blocks/form-fields";

/**
 * Formular-Variante des CTA-Banners (Konzept 5.6): kurzes Kontaktformular
 * fuer alle User ohne Buchungstool. Antworten gehen per POST an
 * `/api/lp/form` (Vertrag: {leadId, name, email, phone, message, website})
 * und landen im CRM am Lead.
 *
 * `website` ist ein Honeypot: unsichtbar, tabIndex -1 — Bots fuellen es
 * aus, Menschen nie. Die API verwirft Eintraege mit Inhalt.
 */

export interface LpFormCtaProps {
  leadId: string;
  /** Vorbefuellung aus den Lead-CSV-Spalten (serverseitig abgeleitet). */
  defaultName?: string;
  defaultEmail?: string;
  /**
   * Formular-Baukasten: eigene Zusatzfelder statt der Defaults
   * Telefon + Nachricht. Ohne `fields` bleibt das bisherige Verhalten
   * (und der bisherige POST-Body) unveraendert.
   */
  fields?: LpFormFieldDef[];
  /** Lead-Spalten fuer die Vorbefuellung (prefillKey). */
  leadData?: Record<string, string | undefined>;
}

type FormPhase = "idle" | "submitting" | "success" | "error";

const inputStyle: React.CSSProperties = {
  background: "var(--lp-color-surface)",
  color: "var(--lp-color-text)",
  border: "1px solid var(--lp-color-border)",
  borderRadius: "var(--lp-radius-input)",
};

const inputClass =
  "w-full min-h-[44px] px-3.5 py-2.5 text-sm outline-none transition-shadow " +
  "focus:ring-2 focus:ring-[color:var(--lp-color-primary)]";

const labelClass = "mb-1.5 block text-left text-sm font-medium";

export function LpFormCta({
  leadId,
  defaultName,
  defaultEmail,
  fields,
  leadData,
}: LpFormCtaProps) {
  const [phase, setPhase] = React.useState<FormPhase>("idle");
  const [name, setName] = React.useState(defaultName ?? "");
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [website, setWebsite] = React.useState("");
  /** Werte der Baukasten-Felder, key = field.id (Vorbefuellung aus Lead). */
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields ?? []) {
      init[f.id] = prefillValue(leadData, f.prefillKey);
    }
    return init;
  });
  /** Mehrfachauswahl getrennt als Array, damit Optionen Kommas enthalten duerfen. */
  const [multiValues, setMultiValues] = React.useState<
    Record<string, string[]>
  >({});

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (phase === "submitting") return;
      setPhase("submitting");
      track("cta_click", { label: "form_submit", url: "", position: "primary" });
      try {
        const body = fields
          ? {
              leadId,
              name,
              email,
              website,
              extra: fields
                .map((f) => ({
                  label: f.label.trim() || "Feld",
                  value:
                    f.type === "multiselect"
                      ? (multiValues[f.id] ?? []).join(", ")
                      : (values[f.id] ?? "").trim(),
                }))
                .filter((f) => f.value.length > 0),
            }
          : { leadId, name, email, phone, message, website };
        const res = await fetch("/api/lp/form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setPhase(res.ok ? "success" : "error");
      } catch {
        setPhase("error");
      }
    },
    [
      phase,
      leadId,
      name,
      email,
      phone,
      message,
      website,
      fields,
      values,
      multiValues,
    ],
  );

  if (phase === "success") {
    return (
      <div
        className="mx-auto w-full max-w-lg p-8 text-center"
        style={{
          background: "var(--lp-color-surface)",
          borderRadius: "var(--lp-radius-card)",
          boxShadow: "var(--lp-shadow-card)",
        }}
      >
        <p className="text-lg font-semibold" style={{ fontFamily: "var(--lp-font-heading)" }}>
          Danke! Deine Nachricht ist angekommen.
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--lp-color-muted)" }}>
          Wir melden uns bei dir.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-lg p-6 sm:p-8"
      style={{
        background: "var(--lp-color-surface)",
        borderRadius: "var(--lp-radius-card)",
        boxShadow: "var(--lp-shadow-card)",
      }}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="lp-form-name" className={labelClass}>
            Name
          </label>
          <input
            id="lp-form-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="lp-form-email" className={labelClass}>
            E-Mail
          </label>
          <input
            id="lp-form-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        {fields ? (
          fields.map((f) => {
            const fieldId = `lp-form-x-${f.id}`;
            const label = f.label.trim() || "Feld";
            const value = values[f.id] ?? "";
            const onChange = (v: string) =>
              setValues((prev) => ({ ...prev, [f.id]: v }));
            return (
              <div key={f.id}>
                <label
                  htmlFor={fieldId}
                  id={`${fieldId}-label`}
                  className={labelClass}
                >
                  {label}{" "}
                  {!f.required && (
                    <span style={{ color: "var(--lp-color-muted)" }}>
                      (optional)
                    </span>
                  )}
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    id={fieldId}
                    rows={4}
                    required={f.required}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn(inputClass, "resize-y")}
                    style={inputStyle}
                  />
                ) : f.type === "select" ? (
                  <select
                    id={fieldId}
                    required={f.required}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                  >
                    <option value="">Bitte wählen …</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : f.type === "multiselect" ? (
                  <div
                    role="group"
                    aria-labelledby={`${fieldId}-label`}
                    className="space-y-2 text-left"
                  >
                    {(f.options ?? []).map((opt, i) => {
                      const selected = multiValues[f.id] ?? [];
                      const checked = selected.includes(opt);
                      return (
                        <label
                          key={opt}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            id={i === 0 ? fieldId : undefined}
                            checked={checked}
                            // required auf allen Checkboxen, solange keine
                            // gewaehlt ist → erzwingt mindestens eine Auswahl.
                            required={f.required && selected.length === 0}
                            onChange={() =>
                              setMultiValues((prev) => ({
                                ...prev,
                                [f.id]: checked
                                  ? selected.filter((s) => s !== opt)
                                  : [...selected, opt],
                              }))
                            }
                            className="size-4 accent-[var(--lp-color-primary)]"
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    id={fieldId}
                    type={f.type}
                    required={f.required}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                  />
                )}
              </div>
            );
          })
        ) : (
          <>
            <div>
              <label htmlFor="lp-form-phone" className={labelClass}>
                Telefon <span style={{ color: "var(--lp-color-muted)" }}>(optional)</span>
              </label>
              <input
                id="lp-form-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="lp-form-message" className={labelClass}>
                Nachricht <span style={{ color: "var(--lp-color-muted)" }}>(optional)</span>
              </label>
              <textarea
                id="lp-form-message"
                name="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={cn(inputClass, "resize-y")}
                style={inputStyle}
              />
            </div>
          </>
        )}
        {/* Honeypot: fuer Menschen unsichtbar, Bots fuellen es aus. */}
        <div style={{ display: "none" }} aria-hidden="true">
          <label htmlFor="lp-form-website">Website</label>
          <input
            id="lp-form-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        {phase === "error" && (
          <p className="text-left text-sm" role="alert" style={{ color: "var(--lp-color-text)" }}>
            Das hat leider nicht geklappt. Bitte versuch es gleich noch einmal.
          </p>
        )}
        <button
          type="submit"
          disabled={phase === "submitting"}
          className={cn(
            "inline-flex min-h-[44px] w-full items-center justify-center px-7 py-3.5",
            "text-sm font-semibold transition-all duration-150",
            "bg-[color:var(--lp-color-primary)] hover:bg-[color:var(--lp-color-primary-hover)]",
            "disabled:opacity-70",
          )}
          style={{
            color: "var(--lp-color-on-primary)",
            borderRadius: "var(--lp-radius-button)",
            boxShadow: "var(--lp-shadow-cta)",
          }}
        >
          {phase === "submitting" ? "Wird gesendet ..." : "Nachricht senden"}
        </button>
      </div>
    </form>
  );
}
