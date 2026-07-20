"use client";

import * as React from "react";

interface HourBucket {
  hour: number;
  count: number;
}

interface HeatmapProps {
  buckets: HourBucket[];
}

function formatHour(h: number): string {
  return String(h).padStart(2, "0");
}

export function Heatmap({ buckets }: HeatmapProps) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const [hovered, setHovered] = React.useState<number | null>(null);

  return (
    <div className="w-full">
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
        {buckets.map((b) => {
          const intensity = b.count === 0 ? 0 : 0.15 + (b.count / max) * 0.85;
          const isHovered = hovered === b.hour;
          return (
            <div
              key={b.hour}
              role="img"
              aria-label={`${b.count} Events um ${formatHour(b.hour)}:00 Uhr`}
              className="relative aspect-square rounded-squircle-sm transition-transform duration-150 ease-spring cursor-default"
              style={{
                background:
                  b.count === 0
                    ? "var(--surface-soft, #ebe9f4)"
                    : `rgba(170, 140, 245, ${intensity.toFixed(3)})`,
                transform: isHovered ? "translateY(-2px)" : undefined,
              }}
              onMouseEnter={() => setHovered(b.hour)}
              onMouseLeave={() => setHovered((h) => (h === b.hour ? null : h))}
            >
              {isHovered && (
                <div
                  className="absolute -top-10 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-squircle-sm bg-surface px-2.5 py-1.5 shadow-card-hover text-[11px]"
                >
                  <div className="font-semibold text-ink">
                    {b.count} {b.count === 1 ? "Event" : "Events"}
                  </div>
                  <div className="text-ink-muted">um {formatHour(b.hour)}:00 Uhr</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="mt-2 grid text-[10px] font-mono text-ink-muted"
        style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
      >
        {buckets.map((b) => (
          <div key={b.hour} className="text-center">
            {[0, 6, 12, 18].includes(b.hour) ? formatHour(b.hour) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
