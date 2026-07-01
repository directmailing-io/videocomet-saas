"use client";

/**
 * Top-Up-Modal — Paket-Auswahl + Direkt-Redirect zu Stripe-Checkout.
 *
 * Wir listen die drei Pakete (50/100/500) statisch — die Preise kommen
 * aus /api/billing/status damit wir nicht doppelt konfigurieren muessen.
 */

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
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

export function TopupModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [packages, setPackages] = React.useState<Pkg[] | null>(null);
  const [selected, setSelected] = React.useState<Pkg["id"]>("credits_100");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        const body = await res.json();
        setPackages(body.packages ?? []);
      } catch {
        // still — packages ist optional, wir zeigen leeren State
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
      // Direkt zu Stripe redirecten — kein setState nachher (Component unmounted).
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credits aufladen</DialogTitle>
          <DialogDescription>
            1 Credit = 1 Video. Credits verfallen nicht. Alle Preise netto,
            zzgl. MwSt.
          </DialogDescription>
        </DialogHeader>

        {packages ? (
          <div className="space-y-2 py-2">
            {packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                className={cn(
                  "w-full text-left rounded-squircle-md border p-3 transition-colors",
                  selected === p.id
                    ? "border-brand bg-brand-soft"
                    : "border-line hover:bg-surface-muted",
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "size-5 rounded-full border-2 flex items-center justify-center shrink-0",
                      selected === p.id
                        ? "border-brand bg-brand"
                        : "border-line",
                    )}
                  >
                    {selected === p.id && (
                      <Check className="size-3 text-white" strokeWidth={3} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{p.label}</div>
                    <div className="text-xs text-ink-muted">
                      {p.discountPct > 0
                        ? `${p.discountPct}% Rabatt vs Einzelpreis`
                        : "Standard-Preis"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-sm">
                      {(p.amountCents / 100).toFixed(2)} €
                    </div>
                    <div className="text-[10px] text-ink-muted">netto</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin inline mr-2" />
            Lade Pakete …
          </div>
        )}

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
