"use client";

import * as React from "react";
import { fmtInt } from "./formatters";

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  views: number;
  plays: number;
  ctas: number;
}

const SERIES: Array<{
  key: "views" | "plays" | "ctas";
  label: string;
  color: string;
}> = [
  { key: "views", label: "Aufrufe", color: "#AA8CF5" },
  { key: "plays", label: "Plays", color: "#7C5CE8" },
  { key: "ctas", label: "CTA-Klicks", color: "#F59E0B" },
];

const W = 920;
const H = 280;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 36;

function fmtDateShort(iso: string): string {
  // "YYYY-MM-DD" → "DD.MM."
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${d}.${m}.`;
}

export function TimeSeriesChart({ data }: { data: TimeSeriesPoint[] }) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-ink-muted">
        Keine Daten im Zeitraum.
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

  // Show at most ~8 x-axis labels so they don't overlap.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        role="img"
        aria-label="Events über Zeit"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid */}
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
                fill="#94A3B8"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {fmtInt(v)}
              </text>
            </g>
          );
        })}

        {/* Lines */}
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

        {/* Hover dots */}
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

        {/* X-axis labels */}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={d.date}
              x={x(i)}
              y={H - PAD_B + 16}
              fontSize={10}
              fill="#94A3B8"
              textAnchor="middle"
            >
              {fmtDateShort(d.date)}
            </text>
          ) : null,
        )}

        {/* Invisible hover overlays */}
        {data.map((_, i) => (
          <rect
            key={i}
            x={x(i) - stepX / 2}
            y={PAD_T}
            width={Math.max(1, stepX)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {/* Vertical hover guide */}
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

        {/* X-axis baseline */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - PAD_B}
          y2={H - PAD_B}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
      </svg>

      {/* Legend + hover summary */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
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
        </div>
        {hoverIdx !== null && (
          <span className="text-xs text-ink-muted tabular-nums">
            {fmtDateShort(data[hoverIdx].date)}
          </span>
        )}
      </div>
    </div>
  );
}
