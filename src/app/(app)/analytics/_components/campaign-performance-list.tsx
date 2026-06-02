"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt, fmtPercent } from "./formatters";

export interface CampaignPerfRow {
  id: string;
  name: string;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  leadsCount: number;
  runsCount: number;
  ctrPct: number;
  temperature: { hot: number; engaged: number; warm: number; cold: number };
}

type SortKey = "ctr" | "views" | "plays" | "leads" | "runs";

/**
 * Sortable campaign-performance list. Server pre-sorts by CTR; client offers
 * row-header toggles. We don't push sort to the URL — it's a transient view
 * preference and the rows are at most ~30 wide on screen anyway.
 */
export function CampaignPerformanceList({
  items,
  baseHref = "/analytics/kampagnen",
}: {
  items: CampaignPerfRow[];
  baseHref?: string;
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>("ctr");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");

  const sorted = React.useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const va = pickSortValue(a, sortKey);
      const vb = pickSortValue(b, sortKey);
      return dir === "desc" ? vb - va : va - vb;
    });
    return copy;
  }, [items, sortKey, dir]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setDir("desc");
    }
  };

  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-ink-muted">
        Keine Aktivität im gewählten Zeitraum.
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1fr_72px_64px_64px_64px_72px_28px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted border-b border-line-soft">
        <div>Kampagne</div>
        <SortHeader k="views" label="Aufrufe" sortKey={sortKey} dir={dir} onClick={toggle} />
        <SortHeader k="plays" label="Plays" sortKey={sortKey} dir={dir} onClick={toggle} />
        <button
          className="text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted"
          type="button"
          disabled
        >
          CTA
        </button>
        <SortHeader k="ctr" label="CTR" sortKey={sortKey} dir={dir} onClick={toggle} />
        <SortHeader k="leads" label="Leads" sortKey={sortKey} dir={dir} onClick={toggle} />
        <div aria-hidden />
      </div>

      <ul className="divide-y divide-line-soft">
        {sorted.map((c) => (
          <li key={c.id}>
            <Link
              href={`${baseHref}/${c.id}`}
              className="grid grid-cols-[1fr_72px_64px_64px_64px_72px_28px] gap-3 px-5 py-3.5 items-center hover:bg-surface-soft transition-colors"
            >
              <div className="min-w-0 flex flex-col gap-1.5">
                <div className="text-sm font-semibold text-ink truncate">
                  {c.name}
                </div>
                <TemperatureBar t={c.temperature} />
              </div>
              <div className="text-sm text-ink tabular-nums">
                {fmtInt(c.pageViews)}
              </div>
              <div className="text-sm text-ink tabular-nums">
                {fmtInt(c.videoPlays)}
              </div>
              <div className="text-sm text-ink tabular-nums">
                {fmtInt(c.ctaClicks)}
              </div>
              <div className="text-sm font-semibold text-ink tabular-nums">
                {fmtPercent(c.ctaClicks, c.pageViews)}
              </div>
              <div className="text-sm text-ink tabular-nums">
                {fmtInt(c.leadsCount)}
              </div>
              <ArrowRight className="size-4 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pickSortValue(c: CampaignPerfRow, k: SortKey): number {
  switch (k) {
    case "ctr":
      return c.pageViews > 0 ? c.ctaClicks / c.pageViews : 0;
    case "views":
      return c.pageViews;
    case "plays":
      return c.videoPlays;
    case "leads":
      return c.leadsCount;
    case "runs":
      return c.runsCount;
  }
}

function SortHeader({
  k,
  label,
  sortKey,
  dir,
  onClick,
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={cn(
        "inline-flex items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider transition-colors",
        active ? "text-ink" : "text-ink-muted hover:text-ink",
      )}
    >
      {label}
      {active &&
        (dir === "desc" ? (
          <ArrowDown className="size-3" />
        ) : (
          <ArrowUp className="size-3" />
        ))}
    </button>
  );
}

function TemperatureBar({
  t,
}: {
  t: { hot: number; engaged: number; warm: number; cold: number };
}) {
  const total = t.hot + t.engaged + t.warm + t.cold;
  if (total === 0) {
    return (
      <div className="h-1.5 w-full rounded-full bg-line-soft" aria-hidden />
    );
  }
  const segs: Array<[number, string, string]> = [
    [t.engaged, "bg-ok", "Engaged"],
    [t.hot, "bg-danger", "Heiß"],
    [t.warm, "bg-warn", "Warm"],
    [t.cold, "bg-ink-muted/60", "Kalt"],
  ];
  return (
    <div
      role="img"
      aria-label={`Lead-Verteilung: ${t.engaged} engaged · ${t.hot} heiß · ${t.warm} warm · ${t.cold} kalt`}
      className="h-1.5 w-full max-w-[280px] flex overflow-hidden rounded-full bg-line-soft"
    >
      {segs.map(([count, color, label]) =>
        count === 0 ? null : (
          <span
            key={label}
            className={color}
            title={`${label}: ${count}`}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ),
      )}
    </div>
  );
}
