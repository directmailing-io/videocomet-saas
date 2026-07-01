"use client";

/**
 * Signup-Modal fuer die Marketing-Seite ("Zugang erhalten"-Button).
 *
 * B2B-only Formular:
 *   - Email + Passwort (min 12 Zeichen, Groß/Klein/Ziffer)
 *   - Vorname + Nachname
 *   - Firmenname (Pflicht)
 *   - USt-ID (optional aber empfohlen fuer Reverse-Charge)
 *   - AGB + Datenschutz-Zustimmung
 *   - Turnstile-Widget (Bot-Schutz)
 *
 * Nach Submit → Redirect zu Stripe-Checkout.
 */

import * as React from "react";
import Script from "next/script";
import { Loader2, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const PASSWORD_MIN = 12;

// Cloudflare Turnstile expects a global. Widget-Rendering ueber Callback.
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

export function SignupModal({ open, onOpenChange }: Props) {
  const turnstileRef = React.useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);

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

  // Turnstile-Widget rendern, wenn Modal offen ist und Script geladen.
  React.useEffect(() => {
    if (!open) return;
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
  }, [open, siteKey]);

  function validatePassword(pw: string): string | null {
    if (pw.length < PASSWORD_MIN) return `Mindestens ${PASSWORD_MIN} Zeichen`;
    if (!/[A-Z]/.test(pw)) return "Mindestens 1 Großbuchstabe";
    if (!/[a-z]/.test(pw)) return "Mindestens 1 Kleinbuchstabe";
    if (!/[0-9]/.test(pw)) return "Mindestens 1 Ziffer";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pwErr = validatePassword(form.password);
    if (pwErr) {
      setPwFeedback(pwErr);
      return;
    }
    if (!form.acceptTerms) {
      setErrorMessage("AGB müssen akzeptiert werden");
      return;
    }
    if (siteKey && !turnstileToken) {
      setErrorMessage("Bot-Schutz noch nicht bestätigt");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
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
      // Redirect zu Stripe-Checkout
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Zugang zu VIDEOCOMET</DialogTitle>
            <DialogDescription>
              40 € / Monat netto, monatlich kündbar. Nur für Unternehmen.
              Nach der Zahlung bist du sofort drin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
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
                />
              </div>
              <div>
                <Label htmlFor="su-lastName">Nachname *</Label>
                <Input
                  id="su-lastName"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="su-email">Email *</Label>
              <Input
                id="su-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoComplete="email"
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
              />
              <p className="text-[11px] mt-1 text-ink-muted">
                {pwFeedback ? (
                  <span className="text-red-600">{pwFeedback}</span>
                ) : (
                  `Mindestens ${PASSWORD_MIN} Zeichen, Groß + Klein + Ziffer`
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
              />
              <p className="text-[11px] mt-1 text-ink-muted">
                Optional — bei EU-Ausland aktiviert Reverse-Charge.
              </p>
            </div>

            {siteKey && (
              <div ref={turnstileRef} className="my-3 flex justify-center" />
            )}

            <label className="flex items-start gap-2 text-xs text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.acceptTerms}
                onChange={(e) =>
                  setForm({ ...form, acceptTerms: e.target.checked })
                }
                required
              />
              <span>
                Ich akzeptiere die{" "}
                <a
                  href="/agb"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  AGB
                </a>{" "}
                und die{" "}
                <a
                  href="/datenschutz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  Datenschutzerklärung
                </a>
                . Die Zahlung ist sofort fällig.
              </span>
            </label>

            <div className="bg-brand-soft rounded-md p-3 text-xs flex items-start gap-2">
              <CheckCircle2 className="size-4 text-brand shrink-0 mt-0.5" />
              <div>
                <strong>40 € / Monat</strong> zzgl. gesetzl. MwSt. Nach Zahlung
                Weiterleitung ins Produkt. Monatlich kündbar.
              </div>
            </div>

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-800">
                {errorMessage}
              </div>
            )}

            <Button
              type="submit"
              variant="brand"
              className="w-full"
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

            <p className="text-center text-xs text-ink-muted pt-2">
              Bereits Kunde?{" "}
              <a href="/login" className="text-brand hover:underline">
                Einloggen
              </a>
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
