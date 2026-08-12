"use client";

import * as React from "react";
import {
  EventIcon,
  describeKind,
  type ActivityKind,
} from "../aktivitaet/_components/event-icon";
import {
  TemperatureDot,
  type LeadTemperature,
} from "../aktivitaet/_components/temperature-badge";

export interface DashboardActivityItem {
  eventId: string;
  /** ISO-8601 */
  ts: string;
  kind: string;
  payload: Record<string, unknown> | null;
  leadName: string;
  campaignName: string;
  temperature: LeadTemperature;
}

function formatRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d === 1) return "gestern";
  if (d < 7) return `vor ${d} Tagen`;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function DashboardActivityList({
  items,
  now,
}: {
  items: DashboardActivityItem[];
  now: number;
}) {
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((it) => (
        <li key={it.eventId} className="flex items-center gap-3 py-3">
          <EventIcon kind={it.kind as ActivityKind} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <TemperatureDot temperature={it.temperature} />
              <span className="truncate">{it.leadName}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {describeKind(it.kind as ActivityKind, it.payload ?? undefined)}
              {" · "}
              {it.campaignName}
            </p>
          </div>
          <span className="shrink-0 text-xs text-ink-muted">
            {formatRelative(it.ts, now)}
          </span>
        </li>
      ))}
    </ul>
  );
}
