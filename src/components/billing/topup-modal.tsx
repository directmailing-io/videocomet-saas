"use client";

/**
 * Top-Up-Modal — kompakt, mobile-first, Sweet-Spot auf 500.
 *
 * Standardansicht: die 4 grossen Pakete (250/500/1000/5000). Die zwei
 * kleinen (50/100) sind hinter einem Disclosure-Link "Kleinere Pakete
 * anzeigen" — verfuegbar, aber optisch zurueckhaltend, damit der Blick
 * bei den umsatzstaerkeren Paketen bleibt.
 *
 * Sweet-Spot: 500er hat "★ Beliebt"-Badge + Ring, ist Default-Selektion.
 */

import * as React from "react";
import { Check, ChevronDown, Loader2, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";

interface Pkg {
  id:
    | "credits_50"
    | "credits_100"
    | "credits_250"
    | "credits_500"
    | "credits_1000"
    | "credits_5000";
  credits: number;
  amountCents: number;
  discountPct: number;
  label: string;
}

const SWEET_SPOT: Pkg["id"] = "credits_500";
const SMALL_IDS = new Set<Pkg["id"]>(["credits_50", "credits_100"]);

function formatEuro(cents: number): string {
  const euro = cents / 100;
  return euro.toLocaleString("de-DE", {
    minimumFractionDigits: euro % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function TopupModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [packages, setPackages] = React.useState<Pkg[] | null>(null);
  const [selected, setSelected] = React.useState<Pkg["id"]>(SWEET_SPOT);
  const [showSmall, setShowSmall] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        const body = await res.json();
        setPackages(body.packages ?? []);
      } catch {
        /* Fallback: leerer State */
      }
    })();
  }, [open]);

  async function handleContinue() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/credits/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: selected }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Checkout konnte nicht gestartet werden",
        description: err instanceof Error ? err.message : undefined,
      });
      setSubmitting(false);
    }
  }

  const bigPkgs = React.useMemo(
    () => packages?.filter((p) => !SMALL_IDS.has(p.id)) ?? [],
    [packages],
  );
  const smallPkgs = React.useMemo(
    () => packages?.filter((p) => SMALL_IDS.has(p.id)) ?? [],
    [packages],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credits aufladen</DialogTitle>
          <DialogDescription className="text-xs">
            1 Credit = 1 Video. E-Mail-Versand ist inklusive. Kein Verfall.
            Preise netto, zzgl. MwSt.
          </DialogDescription>
        </DialogHeader>

        {packages ? (
          <div className="space-y-1.5 -mx-1 px-1 max-h-[52vh] overflow-y-auto">
            {/* Kleinere Pakete (auf Disclosure hinter Link) */}
            {showSmall && smallPkgs.length > 0 ? (
              <div className="space-y-1.5 pb-1">
                {smallPkgs.map((p) => (
                  <PackageRow
                    key={p.id}
                    pkg={p}
                    selected={selected === p.id}
                    isSweetSpot={false}
                    onClick={() => setSelected(p.id)}
                    compact
                  />
                ))}
              </div>
            ) : null}

            {/* Grosse Pakete */}
            {bigPkgs.map((p) => (
              <PackageRow
                key={p.id}
                pkg={p}
                selected={selected === p.id}
                isSweetSpot={p.id === SWEET_SPOT}
                onClick={() => setSelected(p.id)}
              />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin inline mr-2" />
            Lade Pakete …
          </div>
        )}

        {/* Disclosure-Toggle für die zwei kleinen Pakete */}
        {packages && smallPkgs.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowSmall((v) => !v)}
            className="inline-flex items-center gap-1 self-start text-xs text-ink-muted hover:text-brand-deep transition-colors -mt-1"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                showSmall && "rotate-180",
              )}
            />
            {showSmall ? "Kleinere Pakete ausblenden" : "Erst mal kleiner starten?"}
          </button>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={handleContinue}
            disabled={submitting || !packages}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Weiter …
              </>
            ) : (
              "Zahlungspflichtig bestellen"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PackageRow({
  pkg,
  selected,
  isSweetSpot,
  compact = false,
  onClick,
}: {
  pkg: Pkg;
  selected: boolean;
  isSweetSpot: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const anchorCents = pkg.credits * 100;
  const savingsCents = anchorCents - pkg.amountCents;
  const perVideoCents = Math.round(pkg.amountCents / pkg.credits);
  const showAnchor = pkg.discountPct > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full text-left rounded-squircle-sm border transition-all",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        selected
          ? "border-brand bg-brand-soft shadow-[0_6px_20px_-8px_rgba(124,92,232,0.5)]"
          : "border-line hover:border-brand/40 hover:bg-surface-muted",
        isSweetSpot && !selected && "border-brand/40 bg-brand-soft/40",
      )}
    >
      {isSweetSpot ? (
        <div className="absolute -top-2 left-3 inline-flex items-center gap-0.5 rounded-full bg-brand text-white text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider shadow">
          <Star className="size-2.5 fill-white" strokeWidth={0} />
          Beliebt
        </div>
      ) : null}

      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "rounded-full border-2 flex items-center justify-center shrink-0",
            compact ? "size-4" : "size-[18px]",
            selected ? "border-brand bg-brand" : "border-line",
          )}
        >
          {selected && (
            <Check
              className={cn("text-white", compact ? "size-2.5" : "size-3")}
              strokeWidth={3}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "font-semibold leading-tight",
              compact ? "text-[13px]" : "text-sm",
            )}
          >
            {pkg.credits.toLocaleString("de-DE")}{" "}
            <span className="text-ink-muted font-normal">Credits</span>
          </div>
          {!compact && (
            <div className="text-[11px] text-ink-muted mt-0.5 leading-tight">
              {showAnchor ? (
                <>
                  <span className="font-semibold text-emerald-600">
                    {formatEuro(savingsCents)} €
                  </span>{" "}
                  gespart · nur{" "}
                  <span className="text-ink">
                    {(perVideoCents / 100).toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    €
                  </span>
                  /Video
                </>
              ) : (
                <>Einstiegspaket · 1 €/Video</>
              )}
            </div>
          )}
        </div>

        <div className="text-right shrink-0 leading-none">
          {showAnchor && !compact && (
            <div className="text-[10px] text-ink-muted line-through decoration-red-400 tabular-nums">
              {formatEuro(anchorCents)} €
            </div>
          )}
          <div
            className={cn(
              "font-bold tabular-nums",
              compact ? "text-[13px]" : "text-[15px]",
              showAnchor ? "text-brand-deep" : "text-ink",
              !compact && "mt-0.5",
            )}
          >
            {formatEuro(pkg.amountCents)} €
          </div>
          {showAnchor && !compact && (
            <div className="text-[9px] font-bold text-red-600 uppercase tracking-wider mt-0.5">
              −{pkg.discountPct} %
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
