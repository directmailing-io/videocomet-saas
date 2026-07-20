"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { fmtInt } from "./formatters";

export interface TimeSeriesBucket {
  bucket: string;
  label: string;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
}

const SERIES = [
  { key: "pageViews", label: "Aufrufe", color: "#AA8CF5" } as const,
  { key: "videoPlays", label: "Video-Plays", color: "#7C5CE8" } as const,
  { key: "ctaClicks", label: "CTA-Klicks", color: "#10b981" } as const,
];

const W = 960;
const H = 280;
const PAD_L = 40;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 36;

/**
 * Full-width time-series with a day/hour bucket toggle. Renders 3 series
 * (Page-View, Video-Play, CTA) as smooth poly-lines with a hover-tooltip.
 * No external chart library — inline SVG keeps the bundle lean and
 * server-rendering trivial.
 */
export function ActivityTimeSeries({
  data,
  defaultBucket = "day",
  showBucketToggle = true,
}: {
  data: TimeSeriesBucket[];
  defaultBucket?: "day" | "hour";
  showBucketToggle?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  const setBucket = (b: "day" | "hour") => {
    const params = new URLSearchParams(sp.toString());
    params.set("bucket", b);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-ink-muted">
        Keine Aktivität im gewählten Zeitraum.
      </div>
    );
  }

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const max = Math.max(
    1,
    ...data.flatMap((d) => SERIES.map((s) => d[s.key])),
  );
  const ticks = 4;
  const niceMax = Math.ceil(max / ticks) * ticks;
  const tickStep = niceMax / ticks;

  function x(i: number): number {
    return PAD_L + i * stepX;
  }
  function y(v: number): number {
    return PAD_T + innerH - (v / niceMax) * innerH;
  }

  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {SERIES.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-2 text-xs text-ink-muted"
            >
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.label}
              {hoverIdx !== null && (
                <span className="text-ink font-semibold tabular-nums">
                  {fmtInt(data[hoverIdx][s.key])}
                </span>
              )}
            </span>
          ))}
          {hoverIdx !== null && (
            <span className="text-xs text-ink-muted tabular-nums">
              {data[hoverIdx].label}
            </span>
          )}
        </div>
        {showBucketToggle && (
          <div className="inline-flex items-center rounded-full bg-surface-soft p-1">
            {(["day", "hour"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={cn(
                  "h-6 px-3 text-[11px] font-semibold rounded-full transition-colors",
                  defaultBucket === b
                    ? "bg-ink text-surface"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {b === "day" ? "Tag" : "Stunde"}
              </button>
            ))}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        role="img"
        aria-label="Aktivität über Zeit"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = tickStep * i;
          const yPos = y(v);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yPos}
                y2={yPos}
                stroke="#ebebeb"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={yPos}
                fontSize={10}
                fill="#717171"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {fmtInt(v)}
              </text>
            </g>
          );
        })}

        {SERIES.map((s) => {
          const pts = data
            .map((d, i) => `${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`)
            .join(" L ");
          return (
            <path
              key={s.key}
              d={`M ${pts}`}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {hoverIdx !== null &&
          SERIES.map((s) => (
            <circle
              key={s.key}
              cx={x(hoverIdx)}
              cy={y(data[hoverIdx][s.key])}
              r={3.5}
              fill={s.color}
              stroke="#fff"
              strokeWidth={1.5}
            />
          ))}

        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={d.bucket}
              x={x(i)}
              y={H - PAD_B + 18}
              fontSize={10}
              fill="#717171"
              textAnchor="middle"
            >
              {d.label}
            </text>
          ) : null,
        )}

        {data.map((_, i) => (
          <rect
            key={i}
            x={Math.max(PAD_L, x(i) - stepX / 2)}
            y={PAD_T}
            width={Math.max(1, stepX)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {hoverIdx !== null && (
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={PAD_T}
            y2={PAD_T + innerH}
            stroke="#cbd5e1"
            strokeDasharray="2 3"
            strokeWidth={1}
          />
        )}

        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - PAD_B}
          y2={H - PAD_B}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
