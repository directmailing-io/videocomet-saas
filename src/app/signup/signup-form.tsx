"use client";

import * as React from "react";
import Script from "next/script";
import Link from "next/link";
import { Loader2, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Squircle } from "@/components/marketing/Squircle";

const PASSWORD_MIN = 12;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const inputBase = "h-11 !text-[16px] bg-white";

export function SignupForm() {
  const turnstileRef = React.useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    companyName: "",
    vatId: "",
    acceptTerms: false,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [pwFeedback, setPwFeedback] = React.useState<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  React.useEffect(() => {
    if (!siteKey) return;
    if (!turnstileRef.current) return;
    let widgetId: string | null = null;
    function render() {
      if (!window.turnstile || !turnstileRef.current) return;
      widgetId = window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => setTurnstileToken(token),
        "error-callback": () => setTurnstileToken(null),
      });
    }
    if (window.turnstile) {
      render();
    } else {
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          render();
        }
      }, 300);
      return () => clearInterval(t);
    }
    return () => {
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.reset(widgetId);
        } catch {}
      }
    };
  }, [siteKey]);

  function validatePassword(pw: string): string | null {
    if (pw.length < PASSWORD_MIN) return `Mindestens ${PASSWORD_MIN} Zeichen`;
    if (!/[A-Z]/.test(pw)) return "Mindestens 1 Großbuchstabe";
    if (!/[a-z]/.test(pw)) return "Mindestens 1 Kleinbuchstabe";
    if (!/[0-9]/.test(pw)) return "Mindestens 1 Ziffer";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    const pwErr = validatePassword(form.password);
    if (pwErr) {
      setPwFeedback(pwErr);
      return;
    }
    if (!form.acceptTerms) {
      setErrorMessage("Bitte AGB akzeptieren.");
      return;
    }
    if (siteKey && !turnstileToken) {
      setErrorMessage("Bot-Schutz noch nicht bestätigt, kurz warten.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          companyName: form.companyName.trim(),
          vatId: form.vatId.trim() || undefined,
          acceptTerms: true,
          turnstileToken: turnstileToken ?? "dev-mode",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        errorKind?: string;
      };
      if (!res.ok || !body.url) {
        if (body.errorKind === "existing_active") {
          setErrorMessage(
            "Dieses Konto gibt es schon. Log dich einfach ein oder setz dein Passwort zurück.",
          );
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url;
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Da ist was schiefgelaufen. Bitte nochmal.",
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      {siteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-12">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] gap-6 lg:gap-16 items-start">
          {/* ═══════ LINKS: Verkaufs-Text ═══════ */}
          <div className="lg:pr-4 lg:sticky lg:top-24">
            <h1 className="text-[26px] leading-[1.15] sm:text-3xl lg:text-4xl font-bold tracking-tight mb-6 text-ink">
              Starte jetzt und geh bei deiner Zielgruppe nie wieder unter.
            </h1>

            {/* Preis-Card */}
            <Squircle radius={22} shadow="pretty" wrapperClassName="mb-3" className="bg-white p-5">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[32px] sm:text-4xl font-bold leading-none text-ink">40 €</span>
                <span className="text-sm text-ink-muted">im Monat, netto</span>
              </div>
              <p className="text-xs text-ink-muted mb-4">
                Zugang zur Plattform. Zzgl. gesetzl. MwSt.
              </p>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-ink">
                      Heute zahlst du 120 €. Das sind deine ersten 3 Monate.
                    </div>
                    <div className="text-xs text-ink-muted leading-relaxed mt-0.5">
                      Einmal abgebucht, 3 Monate Ruhe.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-ink">
                      Danach immer 3 Monate weiter.
                    </div>
                    <div className="text-xs text-ink-muted leading-relaxed mt-0.5">
                      Kündbar mit einem Monat Vorlauf zum Ende der Laufzeit.
                    </div>
                  </div>
                </div>
              </div>
            </Squircle>

            {/* Credits-Card — bewusst simpel */}
            <Squircle radius={22} shadow="pretty" wrapperClassName="mb-3" className="bg-brand-soft/70 p-5">
              <h3 className="font-semibold text-[15px] text-ink mb-2">
                Videos bezahlst du mit Credits. So einfach:
              </h3>
              <ul className="text-[13px] sm:text-sm text-ink-soft mb-4 space-y-1 leading-relaxed">
                <li>
                  <strong className="font-semibold text-ink">1 Credit = 1 €</strong>
                </li>
                <li>
                  <strong className="font-semibold text-ink">1 Video = 1 Credit</strong>
                </li>
                <li>
                  <strong className="font-semibold text-ink">10 E-Mails = 1 Credit</strong>
                </li>
                <li>Credits verfallen nie. Du lädst nur auf, wenn du sie brauchst.</li>
              </ul>
              <div className="grid grid-cols-3 gap-2 text-center items-end pt-3">
                {/* 100 — Einstieg (kein Anker) */}
                <div className="rounded-lg bg-white border border-line py-2.5 px-1.5">
                  <div className="text-[15px] font-bold text-ink leading-tight">
                    100 €
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5">100 Videos</div>
                  <div className="text-[9px] text-ink-muted/80 mt-0.5">1,00 €/Video</div>
                </div>

                {/* 500 — Sweet-Spot: Anker + Beliebt-Badge + Glow */}
                <div
                  className="rounded-lg bg-white border-2 border-brand py-3 px-1.5 relative"
                  style={{
                    boxShadow: "0 12px 32px -10px rgba(124,92,232,0.45)",
                  }}
                >
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-brand px-2 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider">
                    ★ Beliebt
                  </div>
                  <div className="text-[10px] text-ink-muted/80 line-through decoration-red-400 leading-none tabular-nums">
                    500 €
                  </div>
                  <div className="text-[17px] font-bold text-ink leading-tight mt-0.5 tabular-nums">
                    450 €
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5">500 Videos</div>
                  <div className="text-[9px] font-semibold text-emerald-600 mt-0.5">
                    −50 € · 0,90 €/Video
                  </div>
                </div>

                {/* 1000 — Volume-Play mit Anker */}
                <div className="rounded-lg bg-white border border-line py-2.5 px-1.5">
                  <div className="text-[10px] text-ink-muted/80 line-through decoration-red-400 leading-none tabular-nums">
                    1.000 €
                  </div>
                  <div className="text-[15px] font-bold text-ink leading-tight mt-0.5 tabular-nums">
                    850 €
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5">1000 Videos</div>
                  <div className="text-[9px] font-semibold text-emerald-600 mt-0.5">
                    −150 € · 0,85 €/Video
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-ink-muted mt-4 text-center">
                Bis zu <strong className="text-ink">20 % Rabatt</strong> ab
                5.000 Credits.
              </p>
            </Squircle>

            {/* Trust-Elemente */}
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-ink-soft">
                <Check className="size-4 text-emerald-600 shrink-0" />
                <span>Nur für Unternehmen (B2B)</span>
              </li>
              <li className="flex items-center gap-2 text-ink-soft">
                <Check className="size-4 text-emerald-600 shrink-0" />
                <span>Reverse-Charge bei EU-USt-IdNr.</span>
              </li>
              <li className="flex items-center gap-2 text-ink-soft">
                <Check className="size-4 text-emerald-600 shrink-0" />
                <span>Kreditkarte oder SEPA-Lastschrift, sicher über Stripe</span>
              </li>
            </ul>
          </div>

          {/* ═══════ RECHTS: Formular ═══════ */}
          <Squircle radius={26} shadow="float" className="bg-white p-5 sm:p-7 lg:p-8">
            <h2 className="font-bold text-lg mb-1 lg:hidden text-ink">Konto anlegen</h2>
            <p className="text-xs text-ink-muted mb-4 lg:hidden">
              Dauert weniger als eine Minute.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="su-firstName">Vorname</Label>
                  <Input
                    id="su-firstName"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                    required
                    autoComplete="given-name"
                    autoCapitalize="words"
                    className={inputBase}
                  />
                </div>
                <div>
                  <Label htmlFor="su-lastName">Nachname</Label>
                  <Input
                    id="su-lastName"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                    required
                    autoComplete="family-name"
                    autoCapitalize="words"
                    className={inputBase}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="su-email">Geschäftliche Email</Label>
                <Input
                  id="su-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className={inputBase}
                  placeholder="max@firma.de"
                />
              </div>

              <div>
                <Label htmlFor="su-password">Passwort</Label>
                <Input
                  id="su-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => {
                    setForm({ ...form, password: e.target.value });
                    setPwFeedback(validatePassword(e.target.value));
                  }}
                  required
                  minLength={PASSWORD_MIN}
                  autoComplete="new-password"
                  className={inputBase}
                />
                <p className="text-[11px] mt-1.5">
                  {pwFeedback ? (
                    <span className="text-red-600">{pwFeedback}</span>
                  ) : (
                    <span className="text-ink-muted">
                      Mindestens 12 Zeichen. Groß + Klein + Ziffer.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <Label htmlFor="su-company">Firmenname</Label>
                <Input
                  id="su-company"
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                  required
                  autoComplete="organization"
                  className={inputBase}
                />
              </div>

              <div>
                <Label htmlFor="su-vat">USt-IdNr.</Label>
                <Input
                  id="su-vat"
                  placeholder="DE123456789"
                  value={form.vatId}
                  onChange={(e) => setForm({ ...form, vatId: e.target.value })}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className={inputBase}
                />
                <p className="text-[11px] mt-1 text-ink-muted">
                  Optional. Bei EU-USt-IdNr. wird die MwSt weggerechnet
                  (Reverse-Charge).
                </p>
              </div>

              {siteKey && (
                <div ref={turnstileRef} className="flex justify-center py-2" />
              )}

              <label className="flex items-start gap-2 text-[13px] sm:text-sm text-ink-soft cursor-pointer py-1">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand"
                  checked={form.acceptTerms}
                  onChange={(e) =>
                    setForm({ ...form, acceptTerms: e.target.checked })
                  }
                  required
                />
                <span>
                  Ich akzeptiere die{" "}
                  <Link
                    href="/agb"
                    target="_blank"
                    className="text-brand-deep underline hover:text-ink"
                  >
                    AGB
                  </Link>{" "}
                  (inklusive der 3 Monate Mindestlaufzeit) und die{" "}
                  <Link
                    href="/datenschutz"
                    target="_blank"
                    className="text-brand-deep underline hover:text-ink"
                  >
                    Datenschutzerklärung
                  </Link>
                  . Die Zahlung ist mit Bestellung sofort fällig.
                </span>
              </label>

              {/* Deal-Reminder: Plus-Visualisierung Zugang + Credits */}
              <div className="rounded-xl bg-surface-soft border border-line p-4 sm:p-5">
                <div className="relative">
                  {/* Zugang */}
                  <div className="rounded-lg bg-white border border-line p-3.5">
                    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-ink-muted mb-1.5">
                      Du bestellst jetzt
                    </div>
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-lg font-bold text-ink">Plattform-Zugang</span>
                      <span className="text-sm text-ink-muted">·</span>
                      <span className="text-sm font-semibold text-ink-soft">120 € für 3 Monate</span>
                    </div>
                    <div className="text-[12px] text-ink-muted leading-snug">
                      Wir buchen einmalig 120 € ab (3 × 40 €). Danach immer
                      3 Monate weiter, kündbar mit einem Monat Vorlauf.
                    </div>
                  </div>

                  {/* Plus-Trenner */}
                  <div className="flex items-center justify-center my-3">
                    <div
                      className="size-10 rounded-full bg-brand-soft flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(124,92,232,0.35)]"
                    >
                      <Plus className="size-5 text-brand-deep" strokeWidth={2.5} />
                    </div>
                  </div>

                  {/* Credits */}
                  <div className="rounded-lg bg-white border border-line p-3.5">
                    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-ink-muted mb-1.5">
                      Credits (nach Bedarf)
                    </div>
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-lg font-bold text-ink">Videos aufladen</span>
                      <span className="text-sm text-ink-muted">·</span>
                      <span className="text-sm font-semibold text-ink-soft">1 €/Video</span>
                    </div>
                    <div className="text-[12px] text-ink-muted leading-snug">
                      1 Credit = 1 € = 1 Video, 10 E-Mails = 1 Credit.
                      Verfallen nie. Kaufst du erst, wenn du sie brauchst.
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] sm:text-sm text-red-700">
                  {errorMessage}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 rounded-full bg-ink text-white hover:bg-ink/90 text-[15px] sm:text-base font-semibold shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45)]"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Weiter zu Stripe ...
                  </>
                ) : (
                  "Zahlungspflichtig bestellen"
                )}
              </Button>

              <p className="text-center text-[11px] text-ink-muted pt-1">
                Sichere Zahlung über Stripe. SEPA + Kreditkarte.
              </p>
            </form>
          </Squircle>
        </div>
      </div>
    </>
  );
}
