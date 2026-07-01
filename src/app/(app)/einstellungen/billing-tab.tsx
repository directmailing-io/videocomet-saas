"use client";

/**
 * Abrechnungs-Tab: Subscription-Status, Credit-Balance, Verlauf,
 * Portal-Link zu Stripe fuer Rechnungen + Zahlung-Aktualisierung.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, Zap, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { TopupModal } from "@/components/billing/topup-modal";
import { CreditHistory } from "./credit-history";
import { InvoicesList } from "./invoices-list";

interface Status {
  creditBalance: number;
  subscription: {
    status: string | null;
    currentPeriodEnd: string | null;
    hasStripeAccount: boolean;
  };
}

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  trialing: "Testphase",
  past_due: "Zahlung überfällig",
  canceled: "Gekündigt",
  incomplete: "Nicht abgeschlossen",
  unpaid: "Unbezahlt",
};

export function BillingTab() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [topupOpen, setTopupOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return;
      setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Return-Handling nach Stripe-Checkout: URL-Params zeigen success/cancel.
  React.useEffect(() => {
    const topup = searchParams.get("topup");
    const sub = searchParams.get("sub");
    if (topup === "success") {
      toast({
        variant: "success",
        title: "Danke — Credits werden gutgeschrieben",
        description: "Kann kurz dauern bis der Webhook verarbeitet ist.",
      });
      // Trigger Balance-Refresh in Sidebar + hier
      setTimeout(() => {
        window.dispatchEvent(new Event("credit-balance-changed"));
        void load();
      }, 2000);
    } else if (topup === "cancel") {
      toast({ variant: "danger", title: "Kauf abgebrochen" });
    }
    if (sub === "success") {
      toast({
        variant: "success",
        title: "Subscription aktiviert",
      });
      setTimeout(() => void load(), 2000);
    } else if (sub === "cancel") {
      toast({ variant: "danger", title: "Subscription-Setup abgebrochen" });
    }
  }, [searchParams, toast, load]);

  async function openPortal() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.location.href = body.url;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Portal konnte nicht geöffnet werden",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function activateSubscription() {
    try {
      const res = await fetch(
        "/api/billing/subscription/create-checkout",
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.location.href = body.url;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Checkout konnte nicht gestartet werden",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  if (loading || !status) {
    return (
      <div className="py-8 text-center text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin inline mr-2" />
        Lade …
      </div>
    );
  }

  const subActive =
    status.subscription.status === "active" ||
    status.subscription.status === "trialing";

  const isPastDue = status.subscription.status === "past_due";
  const isCanceled = status.subscription.status === "canceled";
  const isUnpaid = status.subscription.status === "unpaid";

  return (
    <div className="space-y-6">
      {/* Payment-Fail-Warnbanner ganz oben (wenn zutreffend) */}
      {(isPastDue || isUnpaid) && (
        <div className="rounded-squircle-md border-2 border-red-300 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <XCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-sm text-red-900 mb-1">
                {isPastDue
                  ? "Deine letzte Zahlung konnte nicht eingezogen werden"
                  : "Deine Zahlung ist mehrfach fehlgeschlagen"}
              </div>
              <p className="text-xs text-red-800 mb-3 leading-relaxed">
                {isPastDue
                  ? "Stripe versucht die Zahlung automatisch nochmal. Bis dahin hast du weiter Zugang. Wenn du deine Zahlungsmethode aktualisierst, verhinderst du die Sperre."
                  : "Dein Zugang ist gesperrt. Aktualisiere deine Zahlungsmethode oder starte den Plan neu, um wieder rein zu kommen."}
              </p>
              <Button variant="brand" size="sm" onClick={openPortal}>
                Zahlungsmethode aktualisieren
              </Button>
            </div>
          </div>
        </div>
      )}
      {isCanceled && (
        <div className="rounded-squircle-md border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <XCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-sm text-amber-900 mb-1">
                Dein Zugang ist gekündigt
              </div>
              <p className="text-xs text-amber-800 mb-3 leading-relaxed">
                Alle deine Daten bleiben erhalten. Reaktiviere den Plan
                jederzeit, dann bist du sofort wieder produktiv. Unverbrauchte
                Credits laufen nicht ab und stehen dir wieder zur Verfügung.
              </p>
              <Button variant="brand" size="sm" onClick={activateSubscription}>
                Zugang reaktivieren
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription-Card */}
      <div className="rounded-squircle-md border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold">Plattform-Zugang</h3>
            <p className="text-xs text-ink-muted mt-1">
              40 € / Monat netto — Voraussetzung für die Video-Generierung
            </p>
          </div>
          {status.subscription.status ? (
            <Badge
              variant={subActive ? "success" : "warn"}
              className="text-xs"
            >
              {subActive ? (
                <CheckCircle2 className="size-3 mr-1 inline" />
              ) : (
                <XCircle className="size-3 mr-1 inline" />
              )}
              {STATUS_LABEL[status.subscription.status] ?? status.subscription.status}
            </Badge>
          ) : (
            <Badge variant="neutral">Nicht aktiv</Badge>
          )}
        </div>
        {status.subscription.currentPeriodEnd && (
          <p className="text-sm text-ink-muted mb-4">
            Verlängert / endet am{" "}
            <strong className="text-ink">
              {new Date(status.subscription.currentPeriodEnd).toLocaleDateString(
                "de-DE",
              )}
            </strong>
          </p>
        )}
        <div className="flex gap-2">
          {!subActive ? (
            <Button variant="brand" onClick={activateSubscription}>
              Plan aktivieren
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={openPortal}
              iconRight={<ExternalLink className="size-4" />}
            >
              Subscription verwalten
            </Button>
          )}
          {status.subscription.hasStripeAccount && (
            <Button
              variant="ghost"
              onClick={openPortal}
              iconRight={<ExternalLink className="size-4" />}
            >
              Rechnungen einsehen
            </Button>
          )}
        </div>
      </div>

      {/* Credit-Balance-Card */}
      <div className="rounded-squircle-md border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Zap className="size-4 text-brand" />
              Credit-Guthaben
            </h3>
            <p className="text-xs text-ink-muted mt-1">
              1 Credit = 1 € netto = 1 Video. Credits verfallen nicht.
            </p>
          </div>
        </div>
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl font-bold tabular-nums">
            {status.creditBalance}
          </span>
          <span className="text-sm text-ink-muted">
            {status.creditBalance === 1 ? "Credit" : "Credits"}
          </span>
        </div>
        <Button
          variant="brand"
          onClick={() => setTopupOpen(true)}
          iconLeft={<Zap className="size-4" />}
        >
          Credits kaufen
        </Button>
      </div>

      {/* Rechnungen (Stripe) */}
      <InvoicesList />

      {/* Vollstaendige Credit-History mit Kampagne/Runde-Kontext */}
      <CreditHistory />

      <TopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </div>
  );
}
