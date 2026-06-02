import * as React from "react";
import Link from "next/link";
import { Eye, MousePointerClick, Play, Clock } from "lucide-react";
import { fmtDurationVerbose, fmtInt, kindLabel } from "./formatters";
import type { TopLead } from "./analytics-data";

const TEMP_DOT: Record<TopLead["temperature"], string> = {
  engaged: "bg-ok",
  hot: "bg-danger",
  warm: "bg-warn",
  cold: "bg-ink-muted",
};

const TEMP_LABEL: Record<TopLead["temperature"], string> = {
  engaged: "Engaged",
  hot: "Heiß",
  warm: "Warm",
  cold: "Kalt",
};

/**
 * Lead-Heat-Liste — Top 10 nach Aktivitäts-Score im Zeitraum. Klick führt
 * direkt ins Activity-Center (Lead-Scope), das den Drawer öffnet.
 */
export function TopLeadsList({ leads }: { leads: TopLead[] }) {
  if (leads.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-ink-muted">
        Noch keine aktiven Leads in diesem Zeitraum.
      </div>
    );
  }

  const now = Date.now();

  return (
    <ul className="divide-y divide-line-soft">
      {leads.map((l, i) => (
        <li key={l.id}>
          <Link
            href={`/aktivitaet?scope=lead&leadId=${l.id}`}
            className="grid grid-cols-[28px_minmax(0,1fr)_minmax(120px,auto)_minmax(120px,auto)] gap-3 px-5 py-3.5 items-center hover:bg-surface-soft transition-colors"
          >
            <span className="text-xs font-semibold text-ink-muted tabular-nums">
              #{i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={`inline-block size-1.5 rounded-full shrink-0 ${TEMP_DOT[l.temperature]}`}
                  title={TEMP_LABEL[l.temperature]}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-ink truncate">
                  {l.name}
                </span>
                {l.company && (
                  <span className="text-xs text-ink-muted truncate">
                    · {l.company}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-ink-muted">
                <span className="truncate max-w-[280px]">{l.campaignName}</span>
                {l.lastEventTs && (
                  <span className="tabular-nums shrink-0">
                    {l.lastKind ? `${kindLabel(l.lastKind)} ` : ""}
                    {fmtRelative(l.lastEventTs, now)}
                  </span>
                )}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-ink-muted">
              <Stat icon={<Eye className="size-3" />} value={fmtInt(l.pageViews)} />
              <Stat icon={<Play className="size-3" />} value={fmtInt(l.videoPlays)} />
              <Stat
                icon={<MousePointerClick className="size-3" />}
                value={fmtInt(l.ctaClicks)}
              />
            </div>
            <div className="text-xs text-ink-muted tabular-nums whitespace-nowrap flex items-center justify-end gap-1.5">
              <Clock className="size-3" />
              {fmtDurationVerbose(l.watchTimeSec)}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-ink">
      {icon}
      {value}
    </span>
  );
}

function fmtRelative(d: Date | string, now: number): string {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 60) return "gerade eben";
  if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)} Min`;
  if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} h`;
  return `vor ${Math.floor(diffSec / 86400)} T`;
}
