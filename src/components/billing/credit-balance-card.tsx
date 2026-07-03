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
import {
  creditsLabel,
  formatCreditBalance,
  isUnlimitedCredits,
} from "@/lib/billing/format-credits";
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
  const unlimited = isUnlimitedCredits(balance);
  // Grenzwerte:
  //   Zero (0):     Zero-Bild (Tubby knockout), roter State
  //   Low (1-24):   Panic-Bild (Tubby panisch), amber State
  //   Normal (25+): CEO-Bild (Tubby als Boss), brand State
  // Unlimited (≥1M): faellt in "Normal" — kein Aufladen-Zwang, brand-Look.
  const isZero = !unlimited && balance === 0;
  const isLow = !unlimited && balance > 0 && balance < 25;

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

  const bgImageSrc = isZero
    ? "/billing/credit-card-bg-zero.png"
    : isLow
      ? "/billing/credit-card-bg-low.png"
      : "/billing/credit-card-bg.png";

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
            src={bgImageSrc}
            alt=""
            fill
            sizes="240px"
            className="object-cover"
            priority={false}
          />
          {/* Gradient-Overlay: nur so viel Dunkelheit unten, wie fuer
              Text-Kontrast noetig. Oben komplett transparent damit das
              Bild atmet. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        </div>

        {/* Overlay-Content unten */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="flex items-baseline gap-1.5 mb-2">
            <span
              className={cn(
                "font-bold tabular-nums text-white leading-none drop-shadow",
                unlimited ? "text-3xl" : "text-2xl",
              )}
            >
              {formatCreditBalance(balance)}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-white/70 font-medium">
              {creditsLabel(balance)}
            </span>
          </div>
          {unlimited ? (
            <div className="w-full text-[11px] font-semibold text-center text-white/85 bg-white/10 border border-white/15 rounded-md py-1.5">
              Unbegrenzter Account
            </div>
          ) : (
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
          )}
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
