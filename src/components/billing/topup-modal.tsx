"use client";

/**
 * Top-Up-Modal — Paket-Auswahl mit Streichpreis-Anker + Sweet-Spot-Highlight.
 *
 * Verkaufspsychologie:
 * - Bei Paketen mit Rabatt: Streichpreis (credits * 1 €) zeigen, Ersparnis
 *   absolut in €, Rabatt %, und Per-Video-Preis. Anchoring + Loss-Framing.
 * - Default-Selection: credits_500 (Sweet-Spot, 10 % Rabatt).
 *   Nicht der billigste, aber der attraktivste Trade-off.
 * - 500er-Karte bekommt "Beliebteste Wahl"-Badge, groessere visuelle
 *   Betonung (Ring + Brand-Glow), dominiert die Wahrnehmung.
 * - 5000er dient als Decoy: bei diesem Preis wirken 500/1000 vergleichs-
 *   weise "vernuenftig".
 */

import * as React from "react";
import { Check, Loader2, Star, Zap } from "lucide-react";
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

  const selectedPkg = packages?.find((p) => p.id === selected) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Credits aufladen</DialogTitle>
          <DialogDescription>
            1 Credit = 1 Video. Credits verfallen nicht. Alle Preise netto,
            zzgl. MwSt.
          </DialogDescription>
        </DialogHeader>

        {packages ? (
          <div className="space-y-2 py-2">
            {packages.map((p) => {
              const isSweetSpot = p.id === SWEET_SPOT;
              const isSelected = selected === p.id;
              const anchorCents = p.credits * 100; // 1 € pro Credit = Baseline
              const savingsCents = anchorCents - p.amountCents;
              const perVideoCents = Math.round(p.amountCents / p.credits);
              const showAnchor = p.discountPct > 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    "relative w-full text-left rounded-squircle-md border transition-all",
                    isSweetSpot ? "p-4" : "p-3",
                    isSelected
                      ? "border-brand bg-brand-soft shadow-[0_8px_28px_-8px_rgba(124,92,232,0.5)]"
                      : "border-line hover:border-brand/40 hover:bg-surface-muted",
                    isSweetSpot &&
                      !isSelected &&
                      "border-brand/40 bg-brand-soft/40",
                  )}
                >
                  {isSweetSpot ? (
                    <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-brand text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider shadow">
                      <Star className="size-3 fill-white" strokeWidth={0} />
                      Beliebteste Wahl
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "size-5 rounded-full border-2 flex items-center justify-center shrink-0",
                        isSelected ? "border-brand bg-brand" : "border-line",
                      )}
                    >
                      {isSelected && (
                        <Check className="size-3 text-white" strokeWidth={3} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          "font-semibold leading-tight",
                          isSweetSpot ? "text-base" : "text-sm",
                        )}
                      >
                        {p.credits.toLocaleString("de-DE")} Credits
                        <span className="text-ink-muted font-normal">
                          {" "}
                          · {p.credits.toLocaleString("de-DE")} Videos
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {showAnchor ? (
                          <>
                            <span className="font-semibold text-emerald-600">
                              {formatEuro(savingsCents)} €
                            </span>{" "}
                            gespart · nur{" "}
                            <span className="font-semibold text-ink">
                              {(perVideoCents / 100).toLocaleString("de-DE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              €
                            </span>{" "}
                            pro Video
                          </>
                        ) : (
                          <>
                            1 € pro Video · Einstiegspaket
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {showAnchor && (
                        <div className="text-[11px] text-ink-muted line-through decoration-red-400 tabular-nums leading-none">
                          {formatEuro(anchorCents)} €
                        </div>
                      )}
                      <div
                        className={cn(
                          "font-bold tabular-nums leading-tight",
                          isSweetSpot ? "text-lg" : "text-base",
                          showAnchor ? "text-brand-deep" : "text-ink",
                        )}
                      >
                        {formatEuro(p.amountCents)} €
                      </div>
                      <div className="text-[10px] text-ink-muted">netto</div>
                      {showAnchor && (
                        <div className="text-[9px] font-bold text-red-600 uppercase tracking-wider mt-0.5">
                          −{p.discountPct} %
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin inline mr-2" />
            Lade Pakete …
          </div>
        )}

        {selectedPkg ? (
          <div className="rounded-lg bg-brand-soft/50 border border-brand/20 p-3 text-[12px] leading-relaxed">
            <div className="flex items-start gap-2">
              <Zap className="size-4 text-brand shrink-0 mt-0.5" />
              <div>
                Du kaufst{" "}
                <strong>
                  {selectedPkg.credits.toLocaleString("de-DE")} Credits
                </strong>{" "}
                für{" "}
                <strong>{formatEuro(selectedPkg.amountCents)} €</strong> netto.
                Reicht für{" "}
                <strong>
                  {selectedPkg.credits.toLocaleString("de-DE")} personalisierte
                  Videos
                </strong>
                {selectedPkg.discountPct > 0 ? (
                  <>
                    {" "}
                    und du sparst{" "}
                    <strong>
                      {formatEuro(
                        selectedPkg.credits * 100 - selectedPkg.amountCents,
                      )}{" "}
                      €
                    </strong>{" "}
                    gegenüber dem Standardpreis.
                  </>
                ) : (
                  "."
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
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
