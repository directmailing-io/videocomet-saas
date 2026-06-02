import * as React from "react";
import { TrendingDown } from "lucide-react";
import { fmtDurationShort, fmtInt } from "./formatters";
import type { FunnelData } from "./analytics-data";

/**
 * Horizontal funnel with absolute counts + % of top AND % of previous stage.
 * The drop-off hot-spot box below highlights the biggest stage-to-stage loss
 * and, when available, the median abandon-time as actionable context.
 */
export function FunnelOverview({ data }: { data: FunnelData }) {
  const top = data.steps[0]?.count ?? 0;
  const hasAny = data.steps.some((s) => s.count > 0);

  if (!hasAny) {
    return (
      <div className="px-6 py-12 text-center text-sm text-ink-muted">
        Im gewählten Zeitraum gab es keine Aktivität für einen Funnel.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-3">
        {data.steps.map((step, i) => {
          const widthPct = top > 0 ? (step.count / top) * 100 : 0;
          return (
            <div key={step.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">
                  {step.label}
                </span>
                <span className="text-xs text-ink-muted tabular-nums">
                  {fmtInt(step.count)}
                  {i > 0 && (
                    <span className="ml-2 text-ink-muted">
                      · {step.pctOfPrev.toFixed(1).replace(".", ",")} % zur Vorstufe
                    </span>
                  )}
                </span>
              </div>
              <div className="h-7 w-full bg-line-soft rounded-squircle-sm overflow-hidden relative">
                <div
                  className="h-full bg-brand transition-[width] duration-500 ease-spring"
                  style={{ width: `${Math.max(widthPct, 1.5)}%` }}
                />
                <div className="absolute inset-y-0 left-3 flex items-center text-[11px] font-semibold text-white mix-blend-difference">
                  {Math.round(step.pctOfTop)} %
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data.biggestDropoff && (
        <div className="rounded-squircle-sm border border-line bg-surface-soft p-4 flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-squircle-sm bg-warn-soft text-warn">
            <TrendingDown className="size-3.5" />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Größter Drop-Off
            </div>
            <div className="text-sm text-ink leading-snug">
              Zwischen <strong>{data.biggestDropoff.fromLabel}</strong> und{" "}
              <strong>{data.biggestDropoff.toLabel}</strong> verlieren Sie{" "}
              <strong className="tabular-nums">
                {fmtInt(data.biggestDropoff.lostCount)}
              </strong>{" "}
              Leads (
              {data.biggestDropoff.lostPctOfPrev.toFixed(0)} %).
            </div>
            {data.medianAbandonSec != null && data.medianAbandonSec > 0 && (
              <div className="text-xs text-ink-muted leading-snug">
                Häufigste Video-Abbruch-Zeit:{" "}
                <span className="tabular-nums font-semibold text-ink">
                  {fmtDurationShort(data.medianAbandonSec)}
                </span>{" "}
                — prüfen Sie das Intro.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
