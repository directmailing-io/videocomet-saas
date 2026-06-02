"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";

const SEGMENTS: Array<{ key: RangeKey; label: string; short: string; hotkey: string }> = [
  { key: "today", label: "Heute", short: "Heute", hotkey: "T" },
  { key: "7d", label: "7 Tage", short: "7 T", hotkey: "W" },
  { key: "30d", label: "30 Tage", short: "30 T", hotkey: "M" },
  { key: "90d", label: "90 Tage", short: "90 T", hotkey: "Q" },
];

/**
 * Segmented date-range picker. Persists `?range=` to the URL — the page is
 * RSC and re-reads on every change. We use `router.replace` to avoid filling
 * the browser-history with every flick of the segments.
 */
export function RangePicker({
  showCompareToggle = true,
}: {
  showCompareToggle?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const active = (sp.get("range") as RangeKey) || "30d";
  const compare = sp.get("compare") !== "0";
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(sp.get("from") ?? "");
  const [customTo, setCustomTo] = React.useState(sp.get("to") ?? "");

  const pushRange = React.useCallback(
    (next: RangeKey, extras: Record<string, string | null> = {}) => {
      const params = new URLSearchParams(sp.toString());
      params.set("range", next);
      for (const [k, v] of Object.entries(extras)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
      }
      if (next !== "custom") {
        params.delete("from");
        params.delete("to");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  // Keyboard shortcuts
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") pushRange("today");
      else if (k === "w") pushRange("7d");
      else if (k === "m") pushRange("30d");
      else if (k === "q") pushRange("90d");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushRange]);

  const toggleCompare = () => {
    const params = new URLSearchParams(sp.toString());
    if (compare) params.set("compare", "0");
    else params.delete("compare");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    pushRange("custom", { from: customFrom, to: customTo });
    setCustomOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="tablist"
        aria-label="Zeitraum"
        className="inline-flex items-center rounded-full border border-line bg-surface p-1 shadow-card"
      >
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            role="tab"
            type="button"
            aria-selected={active === s.key}
            title={`${s.label} (${s.hotkey})`}
            onClick={() => pushRange(s.key)}
            className={cn(
              "h-7 px-3 text-xs font-semibold rounded-full transition-colors",
              active === s.key
                ? "bg-ink text-surface"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {s.short}
          </button>
        ))}
        <button
          role="tab"
          type="button"
          aria-selected={active === "custom"}
          title="Benutzerdefinierten Zeitraum wählen"
          onClick={() => setCustomOpen(true)}
          className={cn(
            "h-7 px-3 text-xs font-semibold rounded-full transition-colors inline-flex items-center gap-1.5",
            active === "custom"
              ? "bg-ink text-surface"
              : "text-ink-muted hover:text-ink",
          )}
        >
          <Calendar className="size-3" />
          Custom
        </button>
      </div>
      {showCompareToggle && (
        <button
          type="button"
          onClick={toggleCompare}
          aria-pressed={compare}
          title="Vergleich mit Vorperiode an/aus"
          className={cn(
            "h-9 px-3 text-xs font-semibold rounded-full border transition-colors inline-flex items-center gap-1.5",
            compare
              ? "bg-brand-soft text-brand-deep border-brand/30"
              : "bg-surface text-ink-muted border-line hover:text-ink",
          )}
        >
          {compare && <Check className="size-3" />}
          Vergleich
        </button>
      )}

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Zeitraum wählen</DialogTitle>
            <DialogDescription>
              Beide Daten als YYYY-MM-DD.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink">
              Von
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-10 rounded-squircle-sm border border-line bg-surface px-3 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink">
              Bis
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-10 rounded-squircle-sm border border-line bg-surface px-3 text-sm text-ink"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={applyCustom} disabled={!customFrom || !customTo}>
              Anwenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
