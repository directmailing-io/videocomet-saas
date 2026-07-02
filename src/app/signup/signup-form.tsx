"use client";

import * as React from "react";
import Script from "next/script";
import Link from "next/link";
import { Loader2, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const inputDark =
  "!bg-white/[0.06] !border-white/10 !text-white placeholder:!text-white/40 h-11 !text-[16px] focus:!border-white/30 focus:!ring-white/10";

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
            <h1 className="text-[26px] leading-[1.15] sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3 text-white">
              Starte jetzt und geh bei deiner Zielgruppe nie wieder unter.
            </h1>
            <p className="text-[15px] sm:text-base text-white/70 mb-6 leading-relaxed">
              Kinderleicht aufgesetzt. Danach schickst du hunderte, sogar
              tausende personalisierte Videos an potenzielle Kunden. Du
              überzeugst sie. Du bleibst positiv in Erinnerung. Du bekommst
              Kundenanfragen.
            </p>

            {/* Preis-Card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 mb-3 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.7)]">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[32px] sm:text-4xl font-bold leading-none text-white">40 €</span>
                <span className="text-sm text-white/60">im Monat, netto</span>
              </div>
              <p className="text-xs text-white/50 mb-4">
                Zugang zur Plattform. Zzgl. gesetzl. MwSt.
              </p>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Check className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-white">
                      3 entspannte Monate zum Reinkommen.
                    </div>
                    <div className="text-xs text-white/60 leading-relaxed mt-0.5">
                      Kein 6- oder 12-Monats-Vertrag. Danach verlängert sich dein
                      Zugang automatisch um weitere 3 Monate — kündbar mit einem
                      Monat Vorlauf zum Ende der Laufzeit.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Check className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-white">Monatliche Abbuchung.</div>
                    <div className="text-xs text-white/60 mt-0.5">
                      Kein Voraus-Batzen. Du zahlst wie beim Handyvertrag,
                      Monat für Monat.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Credits-Card — kein Icon, klarer Fair-Use-Hinweis */}
            <div className="rounded-2xl border border-brand/30 bg-brand/[0.10] p-5 mb-3">
              <h3 className="font-semibold text-[15px] text-white mb-2">
                Absolut fair: Du zahlst nur, was du wirklich verbrauchst.
              </h3>
              <p className="text-[13px] sm:text-sm text-white/70 mb-4 leading-relaxed">
                Jedes Video, das die Plattform tatsächlich erzeugt, kostet
                1 Credit (1 € netto). Credits lädst du bei Bedarf auf.
                Was du nicht verbrauchst, bleibt liegen — kein Verfall,
                kein monatlicher Zwang, Videos zu verschicken.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center items-end pt-3">
                {/* 100 — Einstieg (kein Anker) */}
                <div className="rounded-lg bg-white/[0.04] border border-white/10 py-2.5 px-1.5">
                  <div className="text-[15px] font-bold text-white leading-tight">
                    100 €
                  </div>
                  <div className="text-[10px] text-white/50 mt-0.5">100 Videos</div>
                  <div className="text-[9px] text-white/40 mt-0.5">1,00 €/Video</div>
                </div>

                {/* 500 — Sweet-Spot: Anker + Beliebt-Badge + Glow */}
                <div
                  className="rounded-lg bg-brand/[0.14] border-2 border-brand py-3 px-1.5 relative"
                  style={{
                    boxShadow: "0 12px 32px -10px rgba(124,92,232,0.7)",
                  }}
                >
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-brand px-2 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider">
                    ★ Beliebt
                  </div>
                  <div className="text-[10px] text-white/45 line-through decoration-red-400 leading-none tabular-nums">
                    500 €
                  </div>
                  <div className="text-[17px] font-bold text-white leading-tight mt-0.5 tabular-nums">
                    450 €
                  </div>
                  <div className="text-[10px] text-white/60 mt-0.5">500 Videos</div>
                  <div className="text-[9px] font-semibold text-emerald-300 mt-0.5">
                    −50 € · 0,90 €/Video
                  </div>
                </div>

                {/* 1000 — Volume-Play mit Anker */}
                <div className="rounded-lg bg-white/[0.04] border border-white/10 py-2.5 px-1.5">
                  <div className="text-[10px] text-white/45 line-through decoration-red-400 leading-none tabular-nums">
                    1.000 €
                  </div>
                  <div className="text-[15px] font-bold text-white leading-tight mt-0.5 tabular-nums">
                    850 €
                  </div>
                  <div className="text-[10px] text-white/50 mt-0.5">1000 Videos</div>
                  <div className="text-[9px] font-semibold text-emerald-300 mt-0.5">
                    −150 € · 0,85 €/Video
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-white/55 mt-4 text-center">
                1 Credit = 1 Video. Bis zu{" "}
                <strong className="text-white/85">20 % Rabatt</strong> ab 5.000
                Credits.
              </p>
            </div>

            {/* Trust-Elemente */}
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-white/70">
                <Check className="size-4 text-emerald-400 shrink-0" />
                <span>Nur für Unternehmen (B2B)</span>
              </li>
              <li className="flex items-center gap-2 text-white/70">
                <Check className="size-4 text-emerald-400 shrink-0" />
                <span>Reverse-Charge bei EU-USt-IdNr.</span>
              </li>
              <li className="flex items-center gap-2 text-white/70">
                <Check className="size-4 text-emerald-400 shrink-0" />
                <span>Kreditkarte oder SEPA-Lastschrift, sicher über Stripe</span>
              </li>
            </ul>
          </div>

          {/* ═══════ RECHTS: Formular ═══════ */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] p-5 sm:p-7 lg:p-8">
            <h2 className="font-bold text-lg mb-1 lg:hidden text-white">Konto anlegen</h2>
            <p className="text-xs text-white/60 mb-4 lg:hidden">
              Dauert weniger als eine Minute.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="su-firstName" className="text-white/85">Vorname</Label>
                  <Input
                    id="su-firstName"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                    required
                    autoComplete="given-name"
                    autoCapitalize="words"
                    className={inputDark}
                  />
                </div>
                <div>
                  <Label htmlFor="su-lastName" className="text-white/85">Nachname</Label>
                  <Input
                    id="su-lastName"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                    required
                    autoComplete="family-name"
                    autoCapitalize="words"
                    className={inputDark}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="su-email" className="text-white/85">Geschäftliche Email</Label>
                <Input
                  id="su-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className={inputDark}
                  placeholder="max@firma.de"
                />
              </div>

              <div>
                <Label htmlFor="su-password" className="text-white/85">Passwort</Label>
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
                  className={inputDark}
                />
                <p className="text-[11px] mt-1.5">
                  {pwFeedback ? (
                    <span className="text-red-400">{pwFeedback}</span>
                  ) : (
                    <span className="text-white/50">
                      Mindestens 12 Zeichen. Groß + Klein + Ziffer.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <Label htmlFor="su-company" className="text-white/85">Firmenname</Label>
                <Input
                  id="su-company"
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                  required
                  autoComplete="organization"
                  className={inputDark}
                />
              </div>

              <div>
                <Label htmlFor="su-vat" className="text-white/85">USt-IdNr.</Label>
                <Input
                  id="su-vat"
                  placeholder="DE123456789"
                  value={form.vatId}
                  onChange={(e) => setForm({ ...form, vatId: e.target.value })}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className={inputDark}
                />
                <p className="text-[11px] mt-1 text-white/50">
                  Optional. Bei EU-USt-IdNr. wird die MwSt weggerechnet
                  (Reverse-Charge).
                </p>
              </div>

              {siteKey && (
                <div ref={turnstileRef} className="flex justify-center py-2" />
              )}

              <label className="flex items-start gap-2 text-[13px] sm:text-sm text-white/70 cursor-pointer py-1">
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
                    className="text-brand-soft underline hover:text-white"
                  >
                    AGB
                  </Link>{" "}
                  (inklusive der 3 Monate Mindestlaufzeit) und die{" "}
                  <Link
                    href="/datenschutz"
                    target="_blank"
                    className="text-brand-soft underline hover:text-white"
                  >
                    Datenschutzerklärung
                  </Link>
                  . Die Zahlung ist mit Bestellung sofort fällig.
                </span>
              </label>

              {/* Deal-Reminder — Plus-Visualisierung: Zugang + Credits */}
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 sm:p-5">
                <div className="relative">
                  {/* Zugang */}
                  <div className="rounded-lg bg-white/[0.04] border border-white/10 p-3.5">
                    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/50 mb-1.5">
                      Du bestellst jetzt
                    </div>
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-lg font-bold text-white">Plattform-Zugang</span>
                      <span className="text-sm text-white/60">·</span>
                      <span className="text-sm font-semibold text-white/85">40 €/Monat</span>
                    </div>
                    <div className="text-[12px] text-white/60 leading-snug">
                      3 entspannte Monate zum Reinkommen. Danach immer 3 Monate weiter,
                      wenn du nicht mit einem Monat Vorlauf kündigst.
                    </div>
                  </div>

                  {/* Plus-Trenner */}
                  <div className="flex items-center justify-center my-3">
                    <div
                      className="size-10 rounded-full bg-brand/25 border border-brand/50 flex items-center justify-center shadow-[0_6px_20px_-4px_rgba(124,92,232,0.5)]"
                    >
                      <Plus className="size-5 text-white" strokeWidth={2.5} />
                    </div>
                  </div>

                  {/* Credits */}
                  <div className="rounded-lg bg-white/[0.04] border border-white/10 p-3.5">
                    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/50 mb-1.5">
                      Credits (nach Bedarf)
                    </div>
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-lg font-bold text-white">Videos aufladen</span>
                      <span className="text-sm text-white/60">·</span>
                      <span className="text-sm font-semibold text-white/85">ab 1 €/Video</span>
                    </div>
                    <div className="text-[12px] text-white/60 leading-snug">
                      Kein Zwang. Kein Verfall. Kannst du überspringen bis du das
                      erste Video wirklich machst.
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-[13px] sm:text-sm text-red-200">
                  {errorMessage}
                </div>
              )}

              <Button
                type="submit"
                variant="brand"
                className="w-full h-12 text-[15px] sm:text-base font-semibold"
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

              <p className="text-center text-[11px] text-white/50 pt-1">
                Sichere Zahlung über Stripe. SEPA + Kreditkarte.
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
