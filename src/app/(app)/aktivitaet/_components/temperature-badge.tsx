"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * LeadTemperature aus dem Aktivitäts-API-Vertrag.
 * cold / warm / hot / engaged / inactive.
 */
export type LeadTemperature =
  | "cold"
  | "warm"
  | "hot"
  | "engaged"
  | "inactive";

export const TEMPERATURE_LABEL: Record<LeadTemperature, string> = {
  hot: "Heiß",
  engaged: "Engaged",
  warm: "Warm",
  cold: "Kalt",
  inactive: "Inaktiv",
};

/**
 * Linear/Vercel-style: eine Akzentfarbe pro Temperatur — sparsam und
 * konsistent zu dem semantischen ok/warn/danger-Set des Design-Systems.
 */
const dotColor: Record<LeadTemperature, string> = {
  hot: "bg-danger",
  engaged: "bg-ok",
  warm: "bg-warn",
  cold: "bg-ink-muted",
  inactive: "bg-line",
};

const ringColor: Record<LeadTemperature, string> = {
  hot: "ring-danger/30",
  engaged: "ring-ok/30",
  warm: "ring-warn/30",
  cold: "ring-line",
  inactive: "ring-line",
};

const textColor: Record<LeadTemperature, string> = {
  hot: "text-danger",
  engaged: "text-ok",
  warm: "text-warn",
  cold: "text-ink-muted",
  inactive: "text-ink-muted",
};

export interface TemperatureDotProps {
  temperature: LeadTemperature;
  className?: string;
  withRing?: boolean;
}

/**
 * Pure dot — for inline use next to a lead name. Includes an aria-label
 * so the temperature is announced to screen readers.
 */
export function TemperatureDot({
  temperature,
  className,
  withRing = false,
}: TemperatureDotProps) {
  return (
    <span
      role="img"
      aria-label={`Lead-Temperatur: ${TEMPERATURE_LABEL[temperature]}`}
      title={TEMPERATURE_LABEL[temperature]}
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        dotColor[temperature],
        withRing && ["ring-2", ringColor[temperature]],
        className,
      )}
    />
  );
}

export interface TemperatureBadgeProps {
  temperature: LeadTemperature;
  className?: string;
  compact?: boolean;
}

/**
 * Pill-Badge variant for the LeadDrawer header. Compact-Variante zeigt nur
 * den Dot und das Label klein daneben.
 */
export function TemperatureBadge({
  temperature,
  className,
  compact,
}: TemperatureBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        textColor[temperature],
        compact && "px-1.5 text-[11px]",
        className,
      )}
    >
      <span
        className={cn("inline-block size-1.5 rounded-full", dotColor[temperature])}
        aria-hidden="true"
      />
      {TEMPERATURE_LABEL[temperature]}
    </span>
  );
}
