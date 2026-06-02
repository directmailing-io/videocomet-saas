"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Funnel-Vertrag aus dem Activity-API. Konservativ getypt — die
 * Reihenfolge der Stufen wird vom Backend bestimmt; wir rendern, was
 * kommt. Erste Stufe = 100 % Referenz.
 */
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** 0..1 — falls Backend keine Prozente liefert, rechnen wir relativ
   *  zur ersten Stufe. */
  percent?: number;
}

export interface FunnelResult {
  stages: FunnelStage[];
}

const DEFAULT_LABELS: Record<string, string> = {
  page_view: "Seite aufgerufen",
  video_play: "Video gestartet",
  video_75: "Video 75 % gesehen",
  video_ended: "Video beendet",
  cta_click: "CTA geklickt",
};

export function FunnelCard({ data }: { data: FunnelResult | null }) {
  if (!data || data.stages.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
            Funnel
          </h2>
          <p className="text-xs text-ink-muted">
            Sobald Events vorliegen, sehen Sie hier die Conversion-Stufen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = data.stages[0]?.count ?? 0;

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
          Funnel
        </h2>
        <ul className="flex flex-col gap-2.5" role="list">
          {data.stages.map((stage, idx) => {
            const pct =
              typeof stage.percent === "number"
                ? Math.max(0, Math.min(1, stage.percent))
                : top > 0
                  ? Math.max(0, Math.min(1, stage.count / top))
                  : 0;
            const label = stage.label || DEFAULT_LABELS[stage.key] || stage.key;
            return (
              <li key={stage.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-ink-soft">{label}</span>
                  <span className="tabular-nums font-semibold text-ink">
                    {stage.count.toLocaleString("de-DE")}
                    <span className="ml-1 text-ink-muted">
                      · {Math.round(pct * 100)}%
                    </span>
                  </span>
                </div>
                <div
                  className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(pct * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label}: ${Math.round(pct * 100)} Prozent`}
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-brand transition-[width] duration-300",
                      idx === 0 && "bg-brand-deep",
                    )}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
