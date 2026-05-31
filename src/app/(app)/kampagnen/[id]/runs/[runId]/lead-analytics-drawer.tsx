"use client";

/**
 * Per-Lead Analytics Drawer
 *
 * Right-side slide-over dialog (Radix Dialog) showing the full tracking
 * picture for one lead: summary tiles, a re-watch heatmap built from the
 * server's 5s-wide buckets, and a chronological event timeline.
 *
 * Lifecycle:
 *  - Open on row click in the live-table; the parent passes the LeadRow.
 *  - On every (re)open we re-fetch `GET /api/leads/:id/analytics` so the
 *    drawer reflects the latest tracking aggregates even after the lead row
 *    was last refreshed via SSE.
 *  - Closes via overlay click, X button, or Escape (all handled by Radix).
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, MousePointerClick, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LeadAnalyticsDrawerLead {
  id: string;
  data: Record<string, string>;
}

export interface LeadAnalyticsDrawerProps {
  lead: LeadAnalyticsDrawerLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AnalyticsSummary {
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  playCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  lastCtaAt: string | null;
}

interface AnalyticsEvent {
  id: string;
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
}

interface AnalyticsBucket {
  sec: number;
  count: number;
}

interface AnalyticsPayload {
  summary: AnalyticsSummary;
  events: AnalyticsEvent[];
  watchTimeBuckets: AnalyticsBucket[];
  videoDurationSec: number | null;
}

const EVENT_TIMELINE_LIMIT = 30;

export function LeadAnalyticsDrawer({
  lead,
  open,
  onOpenChange,
}: LeadAnalyticsDrawerProps): React.JSX.Element {
  const [data, setData] = React.useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch on each open. We reset on close so the next open starts in its
  // loading skeleton state instead of flashing stale data from a previous
  // lead.
  React.useEffect(() => {
    if (!open || !lead) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/leads/${lead.id}/analytics`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as AnalyticsPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Konnte Analytics nicht laden.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, lead]);

  const headerName = lead ? prettyLeadDisplayName(lead.data) : "";
  const headerCompany = lead ? prettyLeadCompany(lead.data) : "";

  const hasAnyActivity =
    !!data &&
    (data.summary.viewCount > 0 ||
      data.summary.playCount > 0 ||
      data.summary.ctaClickCount > 0 ||
      data.events.length > 0);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col overflow-hidden",
            "border-l border-line bg-surface shadow-lift",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            "duration-200",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold leading-tight text-ink">
                {headerName || "Lead-Analytics"}
                {headerCompany ? (
                  <span className="text-ink-muted font-normal">
                    {" "}
                    — {headerCompany}
                  </span>
                ) : null}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-ink-muted">
                Tracking-Übersicht für diesen Lead
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="rounded-full p-1.5 text-ink-muted opacity-70 transition-opacity hover:bg-line-soft hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label="Schliessen"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {loading && <DrawerSkeleton />}
            {!loading && error && (
              <div className="rounded-squircle-md border border-danger-soft bg-danger-soft/40 px-4 py-3 text-sm text-danger">
                Fehler beim Laden: {error}
              </div>
            )}
            {!loading && !error && data && !hasAnyActivity && (
              <div className="rounded-squircle-md border border-line bg-surface-muted px-4 py-8 text-center text-sm text-ink-muted">
                Noch keine Aktivität — der Lead hat die Landingpage noch nicht
                geöffnet.
              </div>
            )}
            {!loading && !error && data && hasAnyActivity && (
              <>
                <SummaryGrid summary={data.summary} />
                <WatchTimeHeatmap
                  events={data.events}
                  videoDurationSec={data.videoDurationSec}
                />
                <EventTimeline events={data.events.slice(0, EVENT_TIMELINE_LIMIT)} />
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SummaryGrid({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Übersicht
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Aufrufe" value={summary.viewCount} />
        <SummaryTile label="Plays" value={summary.playCount} />
        <SummaryTile
          label="Watch-Time"
          value={formatWatchTime(summary.watchTimeSec)}
        />
        <SummaryTile label="Klicks" value={summary.ctaClickCount} />
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-squircle-sm border border-line bg-surface px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold text-ink tabular-nums">
        {value}
      </div>
    </div>
  );
}

/**
 * Pure-SVG horizontal bar chart der gesehenen Video-Sekunden.
 *
 * Buckets werden HIER (client-seitig) aus dem Events-Array berechnet, nicht
 * vom Server vorgebucket — dadurch koennen wir die Bucket-Groesse dynamisch
 * an die Video-Laenge anpassen:
 *
 *   <= 20s  → 1s-Buckets    (kurze Test-Videos)
 *   <= 120s → 2s-Buckets
 *   <= 600s → 10s-Buckets
 *   sonst   → 30s-Buckets
 *
 * Verhindert den frueheren "Ein-Block-Bug" bei sehr kurzen Videos, wo das
 * 5s-Server-Bucketing den gesamten Chart als einen Vollblock rendert.
 */
function WatchTimeHeatmap({
  events,
  videoDurationSec,
}: {
  events: AnalyticsEvent[];
  videoDurationSec: number | null;
}) {
  // Alle Video-Events mit gueltigem atSec sammeln (play / progress / ended).
  const atSecs: number[] = [];
  for (const ev of events) {
    if (
      ev.kind !== "video_play" &&
      ev.kind !== "video_progress" &&
      ev.kind !== "video_ended"
    ) {
      continue;
    }
    const p = ev.payload;
    if (!p || typeof p !== "object") continue;
    const v = (p as Record<string, unknown>).atSec;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n >= 0) atSecs.push(n);
  }

  // No data AND no known duration → nothing meaningful to draw.
  if (atSecs.length === 0 && !videoDurationSec) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Watch-Time-Heatmap
        </h3>
        <div className="rounded-squircle-sm border border-line bg-surface-muted px-3 py-6 text-center text-xs text-ink-muted">
          Sobald jemand das Video startet, erscheint hier eine
          Sekunden-genaue Heatmap.
        </div>
      </div>
    );
  }

  const maxAtSec = atSecs.length > 0 ? Math.max(...atSecs) : 0;
  // Prefer the player-reported duration; fall back to highest observed atSec.
  const totalSec = Math.max(
    videoDurationSec ?? 0,
    Math.ceil(maxAtSec),
    1,
  );

  // Dynamic bucket size — fine-grained for short videos, coarser as duration
  // grows so the chart still fits without becoming a sea of 1px bars.
  const bucketSizeSec =
    totalSec <= 20 ? 1 : totalSec <= 120 ? 2 : totalSec <= 600 ? 10 : 30;
  const bucketCount = Math.max(1, Math.ceil(totalSec / bucketSizeSec));

  const counts = new Map<number, number>();
  for (const s of atSecs) {
    const key = Math.floor(s / bucketSizeSec);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(1, ...Array.from(counts.values()));

  // SVG geometry — narrow gap so even single-bucket charts look like a bar,
  // not a solid block.
  const width = 100;
  const height = 60;
  const padX = 2;
  const innerW = width - padX * 2;
  const barUnit = innerW / bucketCount;
  const barGap = Math.min(0.6, barUnit * 0.15);
  const barWidth = Math.max(0.5, barUnit - barGap);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Watch-Time-Heatmap
        </h3>
        <span className="text-[10px] text-ink-muted">
          {formatWatchTime(totalSec)} Video · {bucketSizeSec}s-Bloecke ·
          Spitze: {maxCount}
        </span>
      </div>
      <div className="rounded-squircle-sm border border-line bg-surface-muted p-3">
        <svg
          viewBox={`0 0 ${width} ${height + 12}`}
          className="h-32 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="Watch-Time-Heatmap"
        >
          {Array.from({ length: bucketCount }).map((_, i) => {
            const x = padX + i * barUnit + barGap / 2;
            const count = counts.get(i) ?? 0;
            const isPeak = count > 0 && count === maxCount;
            const isEmpty = count === 0;
            // Empty slots render as a faint baseline tick so the axis stays
            // perceptible even before any data arrives.
            const h = isEmpty ? 1.2 : (count / maxCount) * height;
            return (
              <rect
                key={i}
                x={x}
                y={height - h}
                width={barWidth}
                height={h}
                rx={0.5}
                className={
                  isEmpty
                    ? "fill-line"
                    : isPeak
                      ? "fill-[var(--color-brand-deep,#3a36e0)]"
                      : "fill-[var(--color-brand,#5a52ff)] opacity-70"
                }
              >
                <title>
                  {formatWatchTime(i * bucketSizeSec)}–
                  {formatWatchTime(i * bucketSizeSec + bucketSizeSec)}:{" "}
                  {count} {count === 1 ? "Aufruf" : "Aufrufe"}
                </title>
              </rect>
            );
          })}
          {/* X-axis tick labels at 0, midpoint, end */}
          <g
            className="fill-current text-[6px]"
            style={{ color: "var(--color-ink-muted, #6b6b80)" }}
          >
            <text x={padX} y={height + 8}>
              0:00
            </text>
            <text x={width / 2} y={height + 8} textAnchor="middle">
              {formatWatchTime(Math.floor(totalSec / 2))}
            </text>
            <text x={width - padX} y={height + 8} textAnchor="end">
              {formatWatchTime(totalSec)}
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function EventTimeline({ events }: { events: AnalyticsEvent[] }) {
  if (events.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Letzte Events
      </h3>
      <ul className="divide-y divide-line/60 rounded-squircle-sm border border-line bg-surface">
        {events.map((ev) => (
          <li key={ev.id} className="flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
              <EventIcon kind={ev.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">
                  {eventLabel(ev.kind)}
                </span>
                <span
                  className="shrink-0 text-[11px] text-ink-muted tabular-nums"
                  title={formatAbsolute(ev.ts)}
                >
                  {formatRel(ev.ts)}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-muted truncate">
                  {payloadPreview(ev) ?? "—"}
                </span>
                <span className="shrink-0 text-[10px] text-ink-muted tabular-nums">
                  {formatAbsolute(ev.ts)}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventIcon({ kind }: { kind: string }): React.JSX.Element {
  if (kind === "page_view") return <Eye className="size-3.5" />;
  if (kind === "video_play" || kind === "video_progress" || kind === "video_ended")
    return <Play className="size-3.5" />;
  if (kind === "cta_click") return <MousePointerClick className="size-3.5" />;
  return <span className="size-1.5 rounded-full bg-ink-muted" />;
}

function eventLabel(kind: string): string {
  switch (kind) {
    case "page_view":
      return "Landingpage geöffnet";
    case "video_play":
      return "Video gestartet";
    case "video_progress":
      return "Video angesehen";
    case "video_ended":
      return "Video beendet";
    case "cta_click":
      return "CTA geklickt";
    default:
      return kind;
  }
}

function payloadPreview(ev: AnalyticsEvent): string | null {
  const p = ev.payload;
  if (!p || typeof p !== "object") return null;
  const at = typeof p.atSec === "number" ? p.atSec : Number(p.atSec);
  const played = typeof p.playedSec === "number" ? p.playedSec : Number(p.playedSec);
  const dur = typeof p.durationSec === "number" ? p.durationSec : Number(p.durationSec);
  const parts: string[] = [];
  if (Number.isFinite(at) && at > 0) parts.push(`bei ${formatWatchTime(Math.floor(at))}`);
  if (Number.isFinite(played) && played > 0)
    parts.push(`gesehen ${formatWatchTime(Math.floor(played))}`);
  if (Number.isFinite(dur) && dur > 0) parts.push(`Dauer ${formatWatchTime(Math.floor(dur))}`);
  if (typeof p.target === "string" && p.target) parts.push(`→ ${p.target}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function DrawerSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-squircle-sm border border-line bg-surface-muted animate-pulse"
          />
        ))}
      </div>
      <div className="h-32 rounded-squircle-sm border border-line bg-surface-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-squircle-sm border border-line bg-surface-muted animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

// ── Local format helpers ────────────────────────────────────────────────────

function formatWatchTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Sekunden-genauer absoluter Zeitstempel in DE-Locale, z.B.
 * "30.05.2026, 21:38:45". Used as both the visible second-line stamp and
 * the title-attribute on the relative-time pill.
 */
function formatAbsolute(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Compact German relative-time. No external dep; precision is whatever lines
 * up with the boundaries a user would care about (just-now / minutes / hours
 * / days). Falls back to a short date if older than ~30 days.
 */
function formatRel(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "gerade eben";
  if (ms < 60_000) return "gerade eben";
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `vor ${m} min`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return `vor ${h} Std`;
  }
  if (ms < 30 * 86_400_000) {
    const days = Math.floor(ms / 86_400_000);
    return `vor ${days} Tg.`;
  }
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function prettyLeadDisplayName(data: Record<string, string>): string {
  const first =
    data.firstName ||
    data.Vorname ||
    data.name ||
    data.fullName ||
    "";
  const last = data.lastName || data.Nachname || "";
  const composed = [first, last].filter(Boolean).join(" ").trim();
  return composed || data.email || data["E-Mail"] || "";
}

function prettyLeadCompany(data: Record<string, string>): string {
  return (
    data.companyName ||
    data.company ||
    data.Firma ||
    data.firma ||
    data.Unternehmen ||
    ""
  );
}
