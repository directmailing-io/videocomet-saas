"use client";

import * as React from "react";

/**
 * Minimal SVG sparkline. Renders a single line over `values` with an optional
 * filled area below. No axes, no labels — designed to live inline in a list row.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  color = "#AA8CF5",
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}) {
  if (values.length === 0) {
    return <div className="text-xs text-ink-muted">—</div>;
  }
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 2;
  const innerH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - (v / max) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${(values.length - 1) * stepX},${height} L 0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block"
      role="img"
      aria-label={label ?? "Sparkline"}
    >
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
