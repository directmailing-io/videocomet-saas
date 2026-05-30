"use client";

import * as React from "react";
import { fmtInt } from "./formatters";

export interface CampaignBarItem {
  id: string;
  name: string;
  views: number;
  plays: number;
  ctas: number;
  runs: number;
}

const SERIES: Array<{
  key: keyof Pick<CampaignBarItem, "views" | "plays" | "ctas" | "runs">;
  label: string;
  color: string;
}> = [
  { key: "views", label: "Aufrufe", color: "#AA8CF5" },
  { key: "plays", label: "Plays", color: "#7C5CE8" },
  { key: "ctas", label: "CTA-Klicks", color: "#F59E0B" },
  { key: "runs", label: "Runden", color: "#94A3B8" },
];

const W = 920;
const H = 280;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 64;

function truncate(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function CampaignBarChart({ items }: { items: CampaignBarItem[] }) {
  const [hover, setHover] = React.useState<{ i: number; s: number } | null>(null);
  if (items.length === 0) return null;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const groupW = innerW / items.length;
  const barGap = 4;
  const barW = Math.max(4, (groupW - barGap * (SERIES.length + 1)) / SERIES.length);

  const max = Math.max(
    1,
    ...items.flatMap((it) => SERIES.map((s) => it[s.key])),
  );
  // Round max up to a "nice" tick for grid lines.
  const ticks = 4;
  const niceMax = Math.ceil(max / ticks) * ticks;
  const tickStep = niceMax / ticks;

  function y(v: number): number {
    return PAD_T + innerH - (v / niceMax) * innerH;
  }

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        role="img"
        aria-label="Kampagnen-Vergleich"
      >
        {/* Y-axis grid + labels */}
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

        {/* Bars per campaign */}
        {items.map((it, i) => {
          const gx = PAD_L + i * groupW;
          return (
            <g key={it.id}>
              {SERIES.map((s, sIdx) => {
                const v = it[s.key];
                const bx = gx + barGap + sIdx * (barW + barGap);
                const by = y(v);
                const bh = Math.max(0, H - PAD_B - by);
                const isHover = hover?.i === i && hover?.s === sIdx;
                return (
                  <rect
                    key={s.key}
                    x={bx}
                    y={by}
                    width={barW}
                    height={bh}
                    rx={3}
                    fill={s.color}
                    opacity={isHover ? 1 : 0.85}
                    onMouseEnter={() => setHover({ i, s: sIdx })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${it.name} · ${s.label}: ${fmtInt(v)}`}</title>
                  </rect>
                );
              })}
              {/* X-axis label */}
              <text
                x={gx + groupW / 2}
                y={H - PAD_B + 16}
                fontSize={11}
                fill="#475569"
                textAnchor="middle"
              >
                {truncate(it.name, 14)}
              </text>
            </g>
          );
        })}

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

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
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
          </span>
        ))}
      </div>
    </div>
  );
}
