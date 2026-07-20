import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "./formatters";

/**
 * Hero-Stat card with big number, delta-vs-prev (▲/▼ + absolute) and inline
 * sparkline. Server-rendered (pure SVG, no client logic) so the dashboard
 * doesn't need to hydrate four extra components.
 */
export interface HeroStatProps {
  label: string;
  value: string;
  unit?: string;
  prevValue?: number;
  curValue?: number;
  spark?: number[];
  /** "more is better" = green up arrow when delta > 0. */
  invertColor?: boolean;
  /** Hide delta — for when the user disabled "Vergleich". */
  showDelta?: boolean;
  icon?: React.ReactNode;
  /** Caption shown under the delta line (e.g. exact prev-period value). */
  hint?: string;
}

export function HeroStat({
  label,
  value,
  unit,
  prevValue,
  curValue,
  spark,
  invertColor,
  showDelta = true,
  icon,
  hint,
}: HeroStatProps) {
  const hasPrev =
    typeof prevValue === "number" &&
    typeof curValue === "number" &&
    Number.isFinite(prevValue) &&
    Number.isFinite(curValue);

  const delta = hasPrev ? (curValue! - prevValue!) : 0;
  const deltaPct =
    hasPrev && prevValue! > 0
      ? ((curValue! - prevValue!) / prevValue!) * 100
      : null;

  const goodUp = !invertColor;
  const positive = delta > 0;
  const negative = delta < 0;
  const colorClass = positive
    ? goodUp
      ? "text-ok"
      : "text-danger"
    : negative
      ? goodUp
        ? "text-danger"
        : "text-ok"
      : "text-ink-muted";

  return (
    <div className="bg-surface rounded-squircle-md shadow-card p-5 flex flex-col gap-3 transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        {icon && (
          <span className="flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep [&>svg]:size-4">
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[40px] font-bold leading-none text-ink tracking-tight tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-sm text-ink-muted font-semibold">{unit}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 min-h-[24px]">
        {showDelta && hasPrev ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
              colorClass,
            )}
            title={hint ?? `Vorperiode: ${fmtInt(prevValue!)}`}
          >
            {positive && <ArrowUpRight className="size-3.5" />}
            {negative && <ArrowDownRight className="size-3.5" />}
            {!positive && !negative && <Minus className="size-3.5" />}
            <span>
              {positive ? "+" : ""}
              {fmtInt(delta)}
              {deltaPct !== null
                ? ` · ${positive ? "+" : ""}${deltaPct.toFixed(1).replace(".", ",")} %`
                : ""}
            </span>
            <span className="text-ink-muted font-normal">vs. vorh.</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted">{hint ?? " "}</span>
        )}
        {spark && spark.length > 0 && (
          <HeroSpark values={spark} positive={positive} negative={negative} />
        )}
      </div>
    </div>
  );
}

/** Inline 60×20 sparkline. Colored by delta direction. */
function HeroSpark({
  values,
  positive,
  negative,
}: {
  values: number[];
  positive: boolean;
  negative: boolean;
}) {
  const W = 64;
  const H = 22;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = positive ? "#10b981" : negative ? "#ef4444" : "#AA8CF5";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="block shrink-0"
      role="presentation"
      aria-hidden="true"
    >
      <path
        d={`M ${pts.join(" L ")}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
