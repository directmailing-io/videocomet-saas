"use client";

import * as React from "react";
import Script from "next/script";
import Link from "next/link";
import { Loader2, Check, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Squircle } from "@/components/marketing/Squircle";

const PASSWORD_MIN = 8;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "refresh-expired"?: "auto" | "manual" | "never";
        },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const inputBase = "h-11 !text-[16px] bg-white";

export function SignupForm() {
  const turnstileRef = React.useRef<HTMLDivElement>(null);
  const turnstileWidgetId = React.useRef<string | null>(null);
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
  const [awaitingVerification, setAwaitingVerification] = React.useState(false);
  const [resendState, setResendState] = React.useState<"idle" | "sending" | "sent">("idle");

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  // Rueckkehr vom Verifizierungslink mit Fehlerstatus (?verify=...).
  React.useEffect(() => {
    const verify = new URLSearchParams(window.location.search).get("verify");
    if (!verify) return;
    if (verify === "expired") {
      setErrorMessage(
        "Dein Bestätigungslink ist abgelaufen. Melde dich einfach nochmal mit denselben Daten an, dann schicken wir dir einen neuen Link.",
      );
    } else if (verify === "checkout_error") {
      setErrorMessage(
        "Deine E-Mail ist bestätigt, aber der Zahlungsschritt konnte nicht gestartet werden. Bitte melde dich nochmal an oder schreib an info@videocomet.de.",
      );
    } else {
      setErrorMessage(
        "Dieser Bestätigungslink ist ungültig. Melde dich einfach nochmal an, dann schicken wir dir einen neuen Link.",
      );
    }
  }, []);

  async function handleResend() {
    if (resendState === "sending") return;
    setResendState("sending");
    try {
      await fetch("/api/auth/signup/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim() }),
      });
    } catch {}
    setResendState("sent");
  }

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
        // Tokens laufen nach ~5 Min ab — ohne Auto-Refresh schlägt der
        // Submit bei langsam ausgefüllten Formularen serverseitig fehl.
        "expired-callback": () => setTurnstileToken(null),
        "refresh-expired": "auto",
      });
      turnstileWidgetId.current = widgetId;
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
        verificationRequired?: boolean;
        error?: string;
        errorKind?: string;
      };
      if (res.ok && body.verificationRequired) {
        setAwaitingVerification(true);
        setSubmitting(false);
        return;
      }
      if (!res.ok || !body.url) {
        if (body.errorKind === "existing_active") {
          setErrorMessage(
            "Dieses Konto gibt es schon. Log dich einfach ein oder setz dein Passwort zurück.",
          );
          setSubmitting(false);
          return;
        }
        throw new Error(
          body.error ??
            "Da ist was schiefgelaufen. Bitte versuch es gleich nochmal.",
        );
      }
      window.location.href = body.url;
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Da ist was schiefgelaufen. Bitte nochmal.",
      );
      // Turnstile-Tokens sind Einmal-Tokens: nach jedem fehlgeschlagenen
      // Submit neues Token holen, sonst scheitert auch der Retry.
      setTurnstileToken(null);
      try {
        if (window.turnstile && turnstileWidgetId.current) {
          window.turnstile.reset(turnstileWidgetId.current);
        }
      } catch {}
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
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[32px] sm:text-4xl font-bold leading-none text-ink">40 €</span>
                <span className="text-sm text-ink-muted">im Monat, netto</span>
              </div>
              <p className="text-[13px] sm:text-sm text-ink-soft leading-relaxed">
                Heute zahlst du 120 € für dein Startquartal und bekommst
                20 Credits als Startguthaben geschenkt. Danach 40 € im Monat,
                monatlich kündbar. Zzgl. MwSt.
              </p>
            </Squircle>

            {/* Credits-Card — bewusst simpel */}
            <Squircle radius={22} shadow="pretty" wrapperClassName="mb-4" className="bg-brand-soft/70 p-5">
              <h3 className="font-semibold text-[15px] text-ink mb-2.5">
                1 Credit = 1 €. Dafür bekommst du pro Lead:
              </h3>
              <ul className="text-[13px] sm:text-sm text-ink-soft mb-3 space-y-1.5 leading-snug">
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="font-semibold text-ink">Persönliches Video</strong> mit
                    seiner Webseite und personalisierter Präsentation
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="font-semibold text-ink">Landingpage</strong>, auf der
                    das Video läuft
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="font-semibold text-ink">Brief</strong> mit Link und
                    QR-Code zum Video
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="font-semibold text-ink">
                      Handschriftlicher Umschlag
                    </strong>{" "}
                    zum Ausdrucken
                  </span>
                </li>
              </ul>
              <p className="text-[13px] sm:text-sm text-ink-soft leading-relaxed">
                Versand per E-Mail über VIDEOCOMET:{" "}
                <strong className="font-semibold text-ink">10 E-Mails = 1 Credit</strong>.
                Deine Credits bleiben dir die gesamte Laufzeit erhalten, du
                lädst nur auf, wenn du sie brauchst.
              </p>
            </Squircle>

            {/* Trust-Elemente */}
            <p className="text-[13px] text-ink-muted">
              Nur für Unternehmen (B2B) · Reverse-Charge bei EU-USt-IdNr. ·
              Sichere Zahlung über Stripe
            </p>
          </div>

          {/* ═══════ RECHTS: Formular ═══════ */}
          <Squircle radius={26} shadow="float" className="bg-white p-5 sm:p-7 lg:p-8">
            {awaitingVerification ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-brand-soft">
                <MailCheck className="size-7 text-brand-deep" />
              </div>
              <h2 className="font-bold text-xl text-ink mb-2">
                Bestätige deine E-Mail-Adresse
              </h2>
              <p className="text-sm text-ink-soft leading-relaxed mb-4">
                Wir haben dir eine E-Mail an{" "}
                <strong className="font-semibold text-ink">{form.email.trim()}</strong>{" "}
                geschickt. Klick auf den Link darin, dann geht es direkt weiter
                zur Zahlung.
              </p>
              <p className="text-[13px] text-ink-muted leading-relaxed mb-5">
                Keine E-Mail bekommen? Schau auch im Spam-Ordner nach.
              </p>
              {resendState === "sent" ? (
                <p className="text-[13px] text-emerald-700 font-medium">
                  E-Mail wurde erneut gesendet.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="subtle"
                  className="rounded-full"
                  onClick={handleResend}
                  disabled={resendState === "sending"}
                >
                  {resendState === "sending" ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Wird gesendet ...
                    </>
                  ) : (
                    "E-Mail erneut senden"
                  )}
                </Button>
              )}
            </div>
            ) : (
            <>
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
                      Mindestens 8 Zeichen.
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
                  (inklusive des Startquartals von 3 Monaten) und die{" "}
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

              {/* Deal-Reminder kurz */}
              <div className="rounded-xl bg-surface-soft border border-line p-4 text-[12px] text-ink-muted leading-relaxed">
                Du bestellst jetzt das{" "}
                <strong className="font-semibold text-ink">
                  Startquartal für 120 €
                </strong>{" "}
                (deine ersten 3 Monate, inklusive 20 Credits Startguthaben).
                Danach 40 € im Monat, monatlich kündbar. Weitere Credits lädst
                du später nach Bedarf auf.
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
                    Einen Moment ...
                  </>
                ) : (
                  "Zahlungspflichtig bestellen"
                )}
              </Button>

              <p className="text-center text-[11px] text-ink-muted pt-1">
                Sichere Zahlung über Stripe. SEPA + Kreditkarte.
              </p>
            </form>
            </>
            )}
          </Squircle>
        </div>
      </div>
    </>
  );
}
