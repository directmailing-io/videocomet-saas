"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ActivityCounts,
  TemperatureFilter,
} from "../activity-center";
import {
  TEMPERATURE_HINT,
  TEMPERATURE_LABEL,
  type LeadTemperature,
} from "./temperature-badge";
import { FunnelCard } from "./funnel-card";
import type { FunnelResult } from "./funnel-card";

/**
 * Links-Rail: 4 Mini-Stat-Cards (Hot/Warm/Cold/Inactive) als
 * Filter-Toggles und optional eine FunnelCard darunter.
 *
 * Auf < lg fällt die Rail in den normalen Flow oberhalb des Feeds.
 */
const TEMPERATURE_ORDER: ReadonlyArray<LeadTemperature> = [
  "hot",
  "warm",
  "cold",
  "inactive",
];

const dotBg: Record<LeadTemperature, string> = {
  hot: "bg-danger",
  warm: "bg-warn",
  cold: "bg-ink-muted",
  inactive: "bg-line",
};

export interface StatsRailProps {
  counts: ActivityCounts | null;
  activeTemperature: TemperatureFilter;
  onTemperatureChange: (t: TemperatureFilter) => void;
  funnel?: FunnelResult | null;
  showFunnel?: boolean;
}

export function StatsRail({
  counts,
  activeTemperature,
  onTemperatureChange,
  funnel,
  showFunnel,
}: StatsRailProps) {
  const byTemp = counts?.byTemperature ?? null;
  return (
    <aside
      className="lg:sticky lg:top-4 lg:self-start flex flex-col gap-4"
      aria-label="Lead-Temperatur und Funnel"
    >
      <Card>
        <CardContent className="p-3">
          <h2 className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Leads nach Temperatur
          </h2>
          <ul className="flex flex-col gap-0.5" role="list">
            {TEMPERATURE_ORDER.map((t) => {
              const count = byTemp?.[t] ?? 0;
              const active = activeTemperature === t;
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() =>
                      onTemperatureChange(active ? "all" : t)
                    }
                    aria-pressed={active}
                    title={TEMPERATURE_HINT[t]}
                    className={cn(
                      "w-full flex items-center gap-2 h-9 px-2 rounded-squircle-sm text-sm transition-colors",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                      active
                        ? "bg-brand-soft text-brand-deep"
                        : "text-ink hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-2 rounded-full shrink-0",
                        dotBg[t],
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex-1 text-left truncate">
                      {TEMPERATURE_LABEL[t]}
                    </span>
                    <span className="tabular-nums text-xs font-semibold text-ink-muted">
                      {count.toLocaleString("de-DE")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {showFunnel && <FunnelCard data={funnel ?? null} />}
    </aside>
  );
}
