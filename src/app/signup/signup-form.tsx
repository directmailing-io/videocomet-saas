"use client";

/**
 * Signup-Formular als volle Seite (kein Modal — verhindert Layout-
 * Bugs bei kleinen Viewports und iOS-Safari-Keyboard-Overlaps).
 *
 * Layout:
 *   - Desktop: 2-Spalten (links Marketing/Info, rechts Formular)
 *   - Tablet/Mobile: 1-Spalte, Marketing-Block ueber dem Formular
 *
 * Mobile-first: alle Inputs haben min. 16px Font (verhindert iOS-Zoom),
 * grosse Touch-Targets (mind. 44px Hoehe), Sticky-Submit-Button-Bereich
 * mit sicherem Bottom-Padding fuer iOS-Home-Indicator.
 */

import * as React from "react";
import Script from "next/script";
import Link from "next/link";
import { Loader2, Check, Zap, Calendar, RotateCw, Info } from "lucide-react";
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
        } catch {
          // still
        }
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
      setErrorMessage("Bot-Schutz noch nicht bestätigt — bitte kurz warten.");
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
            "Konto existiert bereits. Bitte einloggen oder Passwort zurücksetzen.",
          );
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url;
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Registrierung fehlgeschlagen",
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

      <div className="max-w-6xl mx-auto px-4 py-8 sm:py-14">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-8 lg:gap-16 items-start">
          {/* LINKS: Marketing / Info-Block */}
          <div className="lg:pr-4 lg:sticky lg:top-24">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3">
              Zugang zu <span className="text-brand">VIDEOCOMET</span>
            </h1>
            <p className="text-sm sm:text-base text-ink-muted mb-6 leading-relaxed">
              Erstelle dein Konto und starte in Minuten mit personalisierten
              Recruiting-Videos in Serie.
            </p>

            {/* Preismodell klar erklärt */}
            <div className="rounded-2xl border border-line bg-white p-5 sm:p-6 mb-4 shadow-sm">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl sm:text-4xl font-bold">40 €</span>
                <span className="text-sm text-ink-muted">/ Monat netto</span>
              </div>
              <p className="text-xs text-ink-muted mb-4">
                zzgl. gesetzl. MwSt. — Preis für den Plattform-Zugang
              </p>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Calendar className="size-4 text-brand shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">Mindestlaufzeit 3 Monate</div>
                    <div className="text-xs text-ink-muted">
                      Danach automatische Verlängerung um jeweils 3 weitere
                      Monate — kündbar mit einem Monat Frist zum Ende der
                      Laufzeit.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <RotateCw className="size-4 text-brand shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">Monatliche Abrechnung</div>
                    <div className="text-xs text-ink-muted">
                      Du zahlst monatlich 40 € — kein Voraus-Zahlungs-Batzen.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Credits-Erklärung — separater Card, damit klar ist es kommt EXTRA */}
            <div className="rounded-2xl border border-brand/20 bg-brand-soft/60 p-5 sm:p-6 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-5 text-brand" />
                <h3 className="font-semibold text-sm">
                  Für jedes Video brauchst du Credits
                </h3>
              </div>
              <p className="text-xs sm:text-sm text-ink-muted mb-3 leading-relaxed">
                Der 40 €-Plan gibt dir Zugang zur Plattform. Für <strong>jedes
                erzeugte Video</strong> zieht das System <strong>1 Credit</strong> vom
                Guthaben ab. Credits kaufst du separat, wann du willst — sie
                verfallen nicht.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white border border-line py-2 px-1">
                  <div className="text-sm font-bold">50 €</div>
                  <div className="text-[10px] text-ink-muted">50 Credits</div>
                </div>
                <div className="rounded-lg bg-white border border-brand py-2 px-1 relative">
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-brand px-1.5 py-0.5 rounded">
                    −5%
                  </div>
                  <div className="text-sm font-bold">95 €</div>
                  <div className="text-[10px] text-ink-muted">100 Credits</div>
                </div>
                <div className="rounded-lg bg-white border border-brand py-2 px-1 relative">
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-brand px-1.5 py-0.5 rounded">
                    −15%
                  </div>
                  <div className="text-sm font-bold">425 €</div>
                  <div className="text-[10px] text-ink-muted">500 Credits</div>
                </div>
              </div>
              <p className="text-[11px] text-ink-muted mt-3">
                Standardpreis: 1 Credit = 1 € netto. Mengen-Rabatt ab 100
                Credits.
              </p>
            </div>

            {/* Trust-Elemente */}
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-ink-muted">
                <Check className="size-4 text-emerald-500 shrink-0" />
                <span>Nur für Unternehmer (B2B)</span>
              </li>
              <li className="flex items-center gap-2 text-ink-muted">
                <Check className="size-4 text-emerald-500 shrink-0" />
                <span>Reverse-Charge bei EU-USt-IdNr.</span>
              </li>
              <li className="flex items-center gap-2 text-ink-muted">
                <Check className="size-4 text-emerald-500 shrink-0" />
                <span>Kartenzahlung + SEPA-Lastschrift via Stripe</span>
              </li>
            </ul>
          </div>

          {/* RECHTS: Formular */}
          <div className="rounded-2xl border border-line bg-white shadow-sm p-5 sm:p-7 lg:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="su-firstName">Vorname *</Label>
                  <Input
                    id="su-firstName"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                    required
                    autoComplete="given-name"
                    autoCapitalize="words"
                    className="!text-[16px] h-11"
                  />
                </div>
                <div>
                  <Label htmlFor="su-lastName">Nachname *</Label>
                  <Input
                    id="su-lastName"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                    required
                    autoComplete="family-name"
                    autoCapitalize="words"
                    className="!text-[16px] h-11"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="su-email">Geschäfts-Email *</Label>
                <Input
                  id="su-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="!text-[16px] h-11"
                  placeholder="max@firma.de"
                />
              </div>

              <div>
                <Label htmlFor="su-password">Passwort *</Label>
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
                  className="!text-[16px] h-11"
                />
                <p className="text-[11px] mt-1.5">
                  {pwFeedback ? (
                    <span className="text-red-600">{pwFeedback}</span>
                  ) : (
                    <span className="text-ink-muted">
                      Mindestens {PASSWORD_MIN} Zeichen · Groß + Klein + Ziffer
                    </span>
                  )}
                </p>
              </div>

              <div>
                <Label htmlFor="su-company">Firmenname *</Label>
                <Input
                  id="su-company"
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                  required
                  autoComplete="organization"
                  className="!text-[16px] h-11"
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
                  className="!text-[16px] h-11"
                />
                <p className="text-[11px] mt-1 text-ink-muted">
                  Optional. Bei gültiger EU-USt-IdNr. wird Reverse-Charge
                  angewendet (0 % USt).
                </p>
              </div>

              {siteKey && (
                <div ref={turnstileRef} className="flex justify-center py-2" />
              )}

              <label className="flex items-start gap-2 text-xs sm:text-sm text-ink-muted cursor-pointer py-1">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 cursor-pointer"
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
                    className="text-brand hover:underline"
                  >
                    AGB
                  </Link>
                  {" "}(inkl. 3 Monate Mindestlaufzeit) und die{" "}
                  <Link
                    href="/datenschutz"
                    target="_blank"
                    className="text-brand hover:underline"
                  >
                    Datenschutzerklärung
                  </Link>
                  . Die Zahlung ist mit Bestellung sofort fällig.
                </span>
              </label>

              {/* Summary-Card direkt über dem Submit-Button */}
              <div className="rounded-xl bg-brand-soft/70 p-4 text-xs sm:text-sm border border-brand/20">
                <div className="flex items-start gap-2">
                  <Info className="size-4 text-brand shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div>
                      <strong>40 € / Monat netto</strong> · Mindestlaufzeit 3
                      Monate · dann Verlängerung um 3 Monate
                    </div>
                    <div className="text-ink-muted">
                      Für jedes Video wird 1 Credit verbraucht — Credits kaufst
                      du separat, ab 1 € pro Stück.
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs sm:text-sm text-red-800">
                  {errorMessage}
                </div>
              )}

              <Button
                type="submit"
                variant="brand"
                className="w-full h-12 sm:h-12 text-sm sm:text-base"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Weiter zu Stripe …
                  </>
                ) : (
                  "Zahlungspflichtig bestellen — 40 € / Monat"
                )}
              </Button>

              <p className="text-center text-[11px] text-ink-muted pt-1">
                Sichere Zahlung über Stripe · SEPA & Kreditkarte
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
