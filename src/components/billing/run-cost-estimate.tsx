"use client";

/**
 * Run-Cost-Estimate — im Run-Wizard Step 2 vor dem Start-Button.
 *
 * Zeigt: geplante Credits fuer diesen Run + aktuelles Guthaben +
 * Restguthaben nach dem Run. Bei nicht-genug: rote Karte + Aufladen-CTA.
 */

import * as React from "react";
import { Loader2, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  formatCreditBalance,
  isUnlimitedCredits,
} from "@/lib/billing/format-credits";
import { TopupModal } from "./topup-modal";

interface Props {
  leadCount: number;
  onSufficient: (sufficient: boolean) => void;
  /** "receipt": schlanke Bon-Zeilen statt eigener Box (für den Kassenbon im Wizard). */
  variant?: "card" | "receipt";
  /**
   * Kampagne mit personalisierter Video-Begrüßung: 2 Credits pro Video
   * werden reserviert (Spiegel der Reservierung im Start-Endpoint).
   */
  introEnabled?: boolean;
}

interface Status {
  creditBalance: number;
  subscription: { status: string | null };
}

export function RunCostEstimate({
  leadCount,
  onSufficient,
  variant = "card",
  introEnabled = false,
}: Props) {
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
    const onChange = () => void load();
    window.addEventListener("credit-balance-changed", onChange);
    return () => window.removeEventListener("credit-balance-changed", onChange);
  }, [load]);

  // Spiegel von POST /api/runs/[id]/start: 2 Credits pro Video bei
  // aktivierter personalisierter Begrüßung (Fallback erstattet 1 Credit
  // erst nach der Produktion).
  const perVideo = introEnabled ? 2 : 1;
  const cost = leadCount * perVideo;
  const balance = status?.creditBalance ?? 0;
  const remaining = balance - cost;
  const sufficient = balance >= cost;
  const subActive =
    status?.subscription.status === "active" ||
    status?.subscription.status === "trialing";

  React.useEffect(() => {
    onSufficient(sufficient && subActive);
  }, [sufficient, subActive, onSufficient]);

  if (loading) {
    if (variant === "receipt") {
      return (
        <div className="flex items-center gap-2 font-mono text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Guthaben laden …
        </div>
      );
    }
    return (
      <div className="rounded-squircle-md border border-line bg-surface p-4 flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Guthaben laden …
      </div>
    );
  }

  if (!subActive) {
    return (
      <div className="rounded-squircle-md border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-sm text-amber-900">
              Keine aktive Subscription
            </div>
            <p className="text-xs text-amber-800 mt-1">
              Aktiviere dein Startquartal (120 € inkl. 20 Credits) um Runden zu
              starten. Bestehende Daten bleiben sichtbar.
            </p>
            <Button
              type="button"
              variant="brand"
              size="sm"
              className="mt-3"
              onClick={async () => {
                const res = await fetch(
                  "/api/billing/subscription/create-checkout",
                  { method: "POST" },
                );
                const body = await res.json();
                if (body.url) window.location.href = body.url;
              }}
            >
              Plan aktivieren
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "receipt") {
    return (
      <>
        <div className="space-y-1.5 font-mono text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink-muted">Kosten dieser Runde</span>
            <span className="font-semibold tabular-nums">
              −{cost} Credits
            </span>
          </div>
          {introEnabled && (
            <div className="text-[10px] leading-relaxed text-ink-muted">
              2 Credits pro Video mit persönlicher Begrüßung. Bei Namens-Fallback
              wird 1 Credit automatisch erstattet.
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink-muted">Aktuelles Guthaben</span>
            <span className="tabular-nums">{formatCreditBalance(balance)}</span>
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-line" />
        <div className="flex items-baseline justify-between gap-3 font-mono">
          <span className="text-sm font-semibold text-ink">Restguthaben</span>
          <span
            className={cn(
              "text-xl font-bold tabular-nums",
              remaining < 0 && !isUnlimitedCredits(balance)
                ? "text-danger"
                : "text-ok",
            )}
          >
            {isUnlimitedCredits(balance)
              ? "∞"
              : remaining.toLocaleString("de-DE")}
          </span>
        </div>
        {!sufficient && (
          <div className="mt-3 border-t border-dashed border-danger/30 pt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-danger">
              Es fehlen <strong>{cost - balance} Credits</strong>.
            </div>
            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={() => setTopupOpen(true)}
            >
              Jetzt aufladen
            </Button>
          </div>
        )}
        <TopupModal open={topupOpen} onOpenChange={setTopupOpen} />
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "rounded-squircle-md border p-4",
          sufficient ? "border-brand/20 bg-brand-soft" : "border-red-200 bg-red-50",
        )}
      >
        <div className="flex items-center gap-2 mb-3">
          <Zap className="size-4 text-brand" />
          <div className="font-semibold text-sm">Credit-Verbrauch</div>
        </div>
        {introEnabled && (
          <p className="mb-3 text-xs text-ink-muted">
            2 Credits pro Video mit persönlicher Begrüßung. Bei Namens-Fallback
            wird 1 Credit automatisch erstattet.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-muted">Kosten dieser Runde</div>
            <div className="text-lg font-bold tabular-nums">
              {cost} <span className="text-xs font-normal text-ink-muted">Credits</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Aktuelles Guthaben</div>
            <div className="text-lg font-bold tabular-nums">
              {formatCreditBalance(balance)}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Restguthaben</div>
            <div
              className={cn(
                "text-lg font-bold tabular-nums",
                remaining < 0 ? "text-red-600" : "text-emerald-600",
              )}
            >
              {isUnlimitedCredits(balance)
                ? "∞"
                : remaining.toLocaleString("de-DE")}
            </div>
          </div>
        </div>
        {!sufficient && (
          <div className="mt-3 pt-3 border-t border-red-200 flex items-center justify-between gap-3">
            <div className="text-xs text-red-800">
              Es fehlen{" "}
              <strong>{cost - balance} Credits</strong>.
            </div>
            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={() => setTopupOpen(true)}
            >
              Jetzt aufladen
            </Button>
          </div>
        )}
      </div>
      <TopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </>
  );
}
