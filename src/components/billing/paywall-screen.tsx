"use client";

/**
 * Paywall-Screen — wird angezeigt wenn subscriptionStatus nicht 'active' ist.
 *
 * Ausnahme: /einstellungen bleibt sichtbar (dort ist der Abrechnungs-Tab
 * mit Reaktivieren-CTA). Alles andere wird blockiert. Der User sieht
 * einen freundlichen aber klaren Screen mit klarer Handlungs-Option.
 */

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Lock, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

type Reason =
  | "admin"
  | "active"
  | "grace_period"
  | "no_subscription"
  | "past_due_expired"
  | "canceled"
  | "unpaid"
  | "incomplete";

interface Props {
  reason: Reason;
  periodEnd: string | null;
}

const REASON_COPY: Record<
  Reason,
  { title: string; desc: string; primaryLabel: string }
> = {
  admin: { title: "", desc: "", primaryLabel: "" },
  active: { title: "", desc: "", primaryLabel: "" },
  grace_period: { title: "", desc: "", primaryLabel: "" },
  no_subscription: {
    title: "Willkommen — noch kein aktiver Zugang",
    desc:
      "Um die Plattform zu nutzen, aktiviere den 40€/Monat-Plan. Nach der Zahlung bist du sofort drin.",
    primaryLabel: "Zugang aktivieren — 40 € / Monat",
  },
  canceled: {
    title: "Dein Zugang ist pausiert",
    desc:
      "Deine Subscription wurde gekündigt. Deine Daten sind sicher — reaktiviere jederzeit, dann bist du sofort wieder produktiv.",
    primaryLabel: "Zugang reaktivieren",
  },
  past_due_expired: {
    title: "Zahlung überfällig — Zugang pausiert",
    desc:
      "Die letzte Zahlung konnte nicht eingezogen werden. Aktualisiere deine Zahlungsmethode und alles läuft weiter.",
    primaryLabel: "Zahlungsmethode aktualisieren",
  },
  unpaid: {
    title: "Zahlung fehlgeschlagen",
    desc:
      "Nach mehreren Versuchen konnten wir die Zahlung nicht einziehen. Starte den Plan neu — deine Daten bleiben erhalten.",
    primaryLabel: "Plan neu starten",
  },
  incomplete: {
    title: "Zahlung noch nicht abgeschlossen",
    desc:
      "Der Checkout-Vorgang wurde noch nicht bestätigt. Wenn du gerade bezahlt hast, warte einen Moment — sonst starte den Vorgang neu.",
    primaryLabel: "Checkout fortsetzen",
  },
};

export function PaywallScreen({ reason, periodEnd }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<null | "subscribe" | "portal">(null);
  const copy = REASON_COPY[reason];

  async function startSubscription() {
    setBusy("subscribe");
    try {
      const res = await fetch("/api/billing/subscription/create-checkout", {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Fehler");
      window.location.href = body.url;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Konnte nicht starten",
        description: err instanceof Error ? err.message : undefined,
      });
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Fehler");
      window.location.href = body.url;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Portal konnte nicht geöffnet werden",
        description: err instanceof Error ? err.message : undefined,
      });
      setBusy(null);
    }
  }

  // Bei "past_due_expired" ist Portal-Update primär, bei "no_subscription"
  // muss neuer Checkout gestartet werden, bei "canceled" ebenfalls neuer
  // Checkout, weil Subscription geloescht sein kann.
  const primaryAction =
    reason === "past_due_expired" ? openPortal : startSubscription;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="rounded-squircle-lg border border-line bg-surface overflow-hidden shadow-lg">
          {/* Bild-Header mit Overlay */}
          <div className="relative aspect-[16/9] bg-black">
            <Image
              src="/billing/credit-card-bg-zero.png"
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 480px"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
            <div className="absolute inset-0 flex items-end p-6">
              <div className="flex items-center gap-2 text-white">
                <Lock className="size-5" />
                <span className="text-sm font-semibold">Zugang pausiert</span>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h1 className="text-xl font-bold mb-2">{copy.title}</h1>
            <p className="text-sm text-ink-muted mb-4 leading-relaxed">
              {copy.desc}
            </p>

            {/* Was ist enthalten */}
            <ul className="space-y-2 mb-6 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Plattform-Zugang für <strong>40 € / Monat</strong> netto zzgl. MwSt.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>3 Monate Mindestlaufzeit</strong>, danach Verlängerung um jeweils 3 Monate</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Für jedes generierte Video wird <strong>1 Credit</strong> verbraucht — Credits separat, ab 1 € pro Stück</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Deine Kampagnen, Runden und Uploads bleiben erhalten</span>
              </li>
            </ul>

            <div className="flex flex-col gap-2">
              <Button
                variant="brand"
                onClick={primaryAction}
                loading={busy === "subscribe" || busy === "portal"}
                className="w-full"
              >
                {copy.primaryLabel}
              </Button>
              {reason !== "no_subscription" && reason !== "incomplete" && (
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={busy !== null}
                  className="text-xs text-ink-muted hover:text-ink transition-colors py-1"
                >
                  <RefreshCw className="size-3 inline mr-1" />
                  Zahlungsdaten oder Rechnung im Stripe-Portal einsehen
                </button>
              )}
              <div className="pt-4 border-t border-line mt-4 text-center">
                <Link
                  href="/einstellungen?tab=abrechnung"
                  className="text-xs text-brand hover:underline"
                >
                  → Zu den Abrechnungs-Einstellungen
                </Link>
              </div>
            </div>

            {periodEnd && (
              <p className="text-[11px] text-ink-muted mt-4 text-center">
                Letzte gültige Periode endete am{" "}
                {new Date(periodEnd).toLocaleDateString("de-DE")}
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-ink-muted mt-6">
          Fragen? Schreib an{" "}
          <a
            href="mailto:support@videocomet.de"
            className="text-brand hover:underline"
          >
            support@videocomet.de
          </a>
        </p>
      </div>
    </div>
  );
}
