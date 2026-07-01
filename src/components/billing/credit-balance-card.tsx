"use client";

/**
 * Credit-Balance-Card fuer die Sidebar.
 *
 * Zeigt aktuelles Guthaben + "Aufladen"-Button. Poll'd initial nach Mount
 * und wenn ein Custom-Event `credit-balance-changed` gefeuert wird (nach
 * Checkout-Return oder Admin-Adjust).
 */

import * as React from "react";
import { Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { TopupModal } from "./topup-modal";

interface Status {
  creditBalance: number;
  subscription: {
    status: string | null;
    currentPeriodEnd: string | null;
    hasStripeAccount: boolean;
  };
}

export function CreditBalanceCard() {
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

  if (loading || !status) {
    return (
      <div className="px-3 py-3 mx-2 mb-2 rounded-squircle-md bg-surface-muted border border-line flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Guthaben lädt …
      </div>
    );
  }

  const balance = status.creditBalance;
  const isLow = balance <= 10;
  const isZero = balance === 0;

  return (
    <>
      <div
        className={cn(
          "px-3 py-3 mx-2 mb-2 rounded-squircle-md border",
          isZero
            ? "bg-red-50 border-red-200"
            : isLow
              ? "bg-amber-50 border-amber-200"
              : "bg-brand-soft border-brand/20",
        )}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Zap className="size-3.5" />
            Guthaben
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums">{balance}</span>
          <span className="text-xs text-ink-muted">
            {balance === 1 ? "Credit" : "Credits"}
          </span>
        </div>
        {isZero ? (
          <p className="text-[11px] text-red-700 mt-1.5">
            Aufladen um Videos zu generieren.
          </p>
        ) : isLow ? (
          <p className="text-[11px] text-amber-700 mt-1.5">
            Wenig Guthaben — bald aufladen.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setTopupOpen(true)}
          className={cn(
            "mt-2 w-full text-xs font-medium rounded-md py-1.5 transition-colors",
            isZero
              ? "bg-red-600 text-white hover:bg-red-700"
              : isLow
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-brand text-white hover:bg-brand/90",
          )}
        >
          Credits aufladen
        </button>
      </div>
      <TopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </>
  );
}
