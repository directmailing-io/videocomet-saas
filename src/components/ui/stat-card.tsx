import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  /** Einzeilige Erläuterung unter dem Wert (z. B. "2 Leads geöffnet"). */
  hint?: string;
}

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    { className, label, value, unit, trend, trendLabel, icon, hint, ...props },
    ref
  ) => {
    const trendUp = typeof trend === "number" && trend > 0;
    const trendDown = typeof trend === "number" && trend < 0;
    const trendNeutral = trend === 0;

    return (
      <div
        ref={ref}
        className={cn(
          "bg-surface border border-line rounded-squircle-md shadow-card p-5 flex flex-col gap-3",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {label}
          </span>
          {icon && (
            <span className="flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep [&>svg]:size-4">
              {icon}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold leading-none text-ink tracking-tight">
            {value}
          </span>
          {unit && <span className="text-sm text-ink-muted">{unit}</span>}
        </div>
        {hint && (
          <p className="text-xs text-ink-muted truncate -mt-1">{hint}</p>
        )}
        {typeof trend === "number" && (
          <div
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold",
              trendUp && "text-ok",
              trendDown && "text-danger",
              trendNeutral && "text-ink-muted"
            )}
          >
            {trendUp && <ArrowUpRight className="size-3.5" />}
            {trendDown && <ArrowDownRight className="size-3.5" />}
            <span>{Math.abs(trend).toFixed(1)}%</span>
            {trendLabel && (
              <span className="text-ink-muted font-normal">{trendLabel}</span>
            )}
          </div>
        )}
      </div>
    );
  }
);
StatCard.displayName = "StatCard";
