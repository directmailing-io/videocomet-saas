"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/tracker";

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

export function LpFormCta({ leadId, defaultName, defaultEmail }: LpFormCtaProps) {
  const [phase, setPhase] = React.useState<FormPhase>("idle");
  const [name, setName] = React.useState(defaultName ?? "");
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [website, setWebsite] = React.useState("");

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (phase === "submitting") return;
      setPhase("submitting");
      track("cta_click", { label: "form_submit", url: "", position: "primary" });
      try {
        const res = await fetch("/api/lp/form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, name, email, phone, message, website }),
        });
        setPhase(res.ok ? "success" : "error");
      } catch {
        setPhase("error");
      }
    },
    [phase, leadId, name, email, phone, message, website],
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
