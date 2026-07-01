"use client";

/**
 * Credit-Balance-Card fuer die Sidebar.
 *
 * Neues Design: Foto-Hintergrund („CEO of Tubbyland") mit Dark-Gradient-Overlay.
 * Das Bild transportiert den „Bosse-mit-Cash"-Vibe — Text bleibt minimal.
 * Balance + Aufladen-Button sind unten platziert, oben ist das Bild nur mit
 * weichem Overlay abgedunkelt.
 *
 * State-Farbe wird als Border-Glow + Button-Farbe kommuniziert:
 *   - Normal: Brand-Purple
 *   - Low (≤10): Amber
 *   - Zero: Red
 */

import * as React from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
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
      <div className="mx-2 mb-2 px-3 py-3 rounded-squircle-md bg-surface-muted border border-line flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Guthaben lädt …
      </div>
    );
  }

  const balance = status.creditBalance;
  const isLow = balance <= 10 && balance > 0;
  const isZero = balance === 0;

  const borderClass = isZero
    ? "ring-2 ring-red-500/40"
    : isLow
      ? "ring-2 ring-amber-500/40"
      : "ring-1 ring-white/10";

  const buttonClass = isZero
    ? "bg-red-500 hover:bg-red-600"
    : isLow
      ? "bg-amber-500 hover:bg-amber-600"
      : "bg-brand hover:bg-brand/90";

  return (
    <>
      <div
        className={cn(
          "mx-2 mb-2 relative overflow-hidden rounded-squircle-md",
          borderClass,
        )}
      >
        {/* Background image */}
        <div className="relative w-full aspect-[4/3]">
          <Image
            src="/billing/credit-card-bg.png"
            alt=""
            fill
            sizes="240px"
            className="object-cover"
            priority={false}
          />
          {/* Gradient-Overlay: dunkel unten, semi-transparent oben.
              Zusaetzlich ein Vignette-Effekt fuer premium-Feel. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
        </div>

        {/* Overlay-Content unten */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-2xl font-bold tabular-nums text-white leading-none drop-shadow">
              {balance}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-white/70 font-medium">
              {balance === 1 ? "Credit" : "Credits"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTopupOpen(true)}
            className={cn(
              "w-full text-xs font-semibold rounded-md py-1.5 text-white transition-colors shadow-lg",
              buttonClass,
            )}
          >
            {isZero ? "Jetzt aufladen" : "Aufladen"}
          </button>
        </div>

        {/* State-Badge oben-links wenn niedrig / null */}
        {(isZero || isLow) && (
          <div
            className={cn(
              "absolute top-2 left-2 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
              isZero ? "bg-red-500 text-white" : "bg-amber-500 text-white",
            )}
          >
            {isZero ? "Leer" : "Wenig"}
          </div>
        )}
      </div>
      <TopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </>
  );
}
