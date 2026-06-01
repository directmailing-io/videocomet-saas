"use client";

import * as React from "react";
import {
  Download,
  Eye,
  FileSpreadsheet,
  MousePointerClick,
  Play,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Filter = "all" | "opened" | "played" | "cta";

interface FilterDef {
  key: Filter;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}

const FILTERS: FilterDef[] = [
  {
    key: "all",
    label: "Alle Leads",
    hint: "Jeder Lead der Kampagne, unabhaengig von Aktivitaet.",
    icon: Users,
  },
  {
    key: "opened",
    label: "Landingpage geöffnet",
    hint: "Leads, die die personalisierte Seite mindestens einmal aufgerufen haben.",
    icon: Eye,
  },
  {
    key: "played",
    label: "Video abgespielt",
    hint: "Leads, die das Video gestartet haben.",
    icon: Play,
  },
  {
    key: "cta",
    label: "CTA geklickt",
    hint: "Leads, die mindestens einmal auf einen CTA geklickt haben.",
    icon: MousePointerClick,
  },
];

export function CampaignLeadExport({ campaignId }: { campaignId: string }) {
  const [filter, setFilter] = React.useState<Filter>("opened");

  function buildHref(format: "csv" | "xlsx"): string {
    const u = new URL(
      `/api/analytics/campaigns/${campaignId}/leads/export`,
      typeof window === "undefined"
        ? "https://app.videocomet.de"
        : window.location.origin,
    );
    u.searchParams.set("filter", filter);
    u.searchParams.set("format", format);
    return u.pathname + u.search;
  }

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-2">
          Welche Leads
        </p>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            const isActive = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  isActive
                    ? "border-brand-deep bg-brand-soft text-brand-deep"
                    : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-ink-muted mt-2">{active.hint}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mr-1">
          Format
        </p>
        <a
          href={buildHref("xlsx")}
          download
          className="inline-flex items-center gap-2 rounded-squircle-sm bg-brand-deep px-3.5 py-1.5 text-xs font-semibold text-white shadow-brand hover:bg-brand-deep/90 transition-colors"
        >
          <FileSpreadsheet className="size-3.5" />
          Excel (.xlsx)
        </a>
        <a
          href={buildHref("csv")}
          download
          className="inline-flex items-center gap-2 rounded-squircle-sm border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-ink-muted transition-colors"
        >
          <Download className="size-3.5" />
          CSV
        </a>
      </div>
    </div>
  );
}
