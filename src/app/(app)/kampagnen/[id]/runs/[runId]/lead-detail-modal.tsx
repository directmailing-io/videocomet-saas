"use client";

/**
 * Lead-Detailansicht (Run-Detail): zentriertes CRM-Modal mit Tabs
 * „Kontaktdaten" (alle importierten Felder + Dokument-Links) und „Aktivität"
 * (Analytics: Übersicht, Engagement-Verlauf, Event-Timeline). Bei jedem
 * Öffnen wird `GET /api/leads/:id/analytics` frisch geladen.
 */

import * as React from "react";
import {
  ExternalLink,
  Eye,
  FileDown,
  Mail,
  MousePointerClick,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { Badge } from "@/components/ui/badge";
import { formatCompanyName, formatPersonName } from "@/lib/format-name";
import {
  CrmDetailModal,
  LeadFieldGrid,
  crmInitials,
} from "@/components/crm/detail-modal";

export interface LeadDetailModalLead {
  id: string;
  slug: string | null;
  /** Custom-Domain-Hostname falls die Kampagne eine aktive hat. */
  customHostname?: string | null;
  data: Record<string, string>;
  /** Optional: Pipeline-Status für die Status-Pille im Header. */
  status?: string;
  /** Optional: direkte Download-Links für Brief/Umschlag. */
  pdfUrl?: string | null;
  envelopePdfUrl?: string | null;
  /** Brief-Variante bei A/B-Runden. */
  abVariant?: "A" | "B" | null;
}

export interface LeadDetailModalProps {
  lead: LeadDetailModalLead | null;
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

export function LeadDetailModal({
  lead,
  open,
  onOpenChange,
}: LeadDetailModalProps): React.JSX.Element {
  const [tab, setTab] = React.useState<"kontakt" | "aktivitaet">("kontakt");
  const [data, setData] = React.useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setTab("kontakt");
  }, [open]);

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

  const headerName = lead
    ? formatPersonName(prettyLeadDisplayName(lead.data))
    : "";
  const headerCompany = lead
    ? formatCompanyName(prettyLeadCompany(lead.data))
    : "";

  const hasAnyActivity =
    !!data &&
    (data.summary.viewCount > 0 ||
      data.summary.playCount > 0 ||
      data.summary.ctaClickCount > 0 ||
      data.events.length > 0);

  return (
    <CrmDetailModal
      open={open}
      onOpenChange={onOpenChange}
      initials={crmInitials(headerName)}
      title={headerName || "Lead-Details"}
      subtitle={headerCompany || "Kontaktdaten & Aktivität für diesen Lead"}
      badges={
        (lead?.status || lead?.abVariant) && (
          <>
            {lead?.status && (
              <Badge variant={leadStatusVariant(lead.status)} dot>
                {leadStatusLabel(lead.status)}
              </Badge>
            )}
            {lead?.abVariant && (
              <Badge variant={lead.abVariant === "A" ? "brand" : "warn"}>
                Brief {lead.abVariant}
              </Badge>
            )}
          </>
        )
      }
      headerActions={
        lead?.slug ? (
          <a
            href={
              buildLeadPublicUrl(
                {
                  slug: lead.slug,
                  customHostname: lead.customHostname ?? null,
                },
                { preview: true },
              ) ?? `/v/${lead.slug}?preview=1`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:bg-canvas-deep hover:text-ink transition-colors"
            title={
              lead.customHostname
                ? `Auf ${lead.customHostname} im Vorschau-Modus öffnen`
                : "Landingpage im Vorschau-Modus öffnen (kein Tracking)"
            }
          >
            <ExternalLink className="size-3" />
            Vorschau
          </a>
        ) : undefined
      }
      tabs={[
        { id: "kontakt", label: "Kontaktdaten" },
        { id: "aktivitaet", label: "Aktivität" },
      ]}
      activeTab={tab}
      onTabChange={(id) => setTab(id as "kontakt" | "aktivitaet")}
    >
      {tab === "kontakt" ? (
        <div className="space-y-3">
          <LeadFieldGrid data={lead?.data} />
          {(lead?.pdfUrl || lead?.envelopePdfUrl) && (
            <div className="flex flex-wrap gap-2">
              {lead?.pdfUrl && (
                <a
                  href={`/api/leads/${lead.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas-deep transition-colors"
                >
                  <FileDown className="size-3.5" />
                  Brief-PDF
                </a>
              )}
              {lead?.envelopePdfUrl && (
                <a
                  href={`/api/leads/${lead.id}/envelope-pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas-deep transition-colors"
                >
                  <Mail className="size-3.5" />
                  Umschlag-PDF
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {loading && <DrawerSkeleton />}
          {!loading && error && (
            <div className="rounded-squircle-md bg-danger-soft px-4 py-3 text-sm text-danger">
              Fehler beim Laden: {error}
            </div>
          )}
          {!loading && !error && data && !hasAnyActivity && (
            <div className="rounded-squircle-md bg-surface-soft px-4 py-8 text-center text-sm text-ink-muted">
              Noch keine Aktivität — der Lead hat die Landingpage noch nicht
              geöffnet.
            </div>
          )}
          {!loading && !error && data && hasAnyActivity && (
            <>
              <SummaryGrid summary={data.summary} />
              <EngagementStory
                events={data.events}
                videoDurationSec={data.videoDurationSec}
              />
              <EventTimeline
                events={data.events.slice(0, EVENT_TIMELINE_LIMIT)}
              />
            </>
          )}
        </div>
      )}
    </CrmDetailModal>
  );
}

function leadStatusVariant(
  s: string,
): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (s) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "rendering":
    case "uploading":
      return "brand";
    default:
      return "neutral";
  }
}

function leadStatusLabel(s: string): string {
  switch (s) {
    case "pending":
      return "Wartet";
    case "rendering":
      return "Rendert";
    case "uploading":
      return "Hochladen";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    default:
      return s;
  }
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
    <div className="rounded-squircle-sm bg-surface-soft px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold text-ink tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ── Engagement-Story ────────────────────────────────────────────────────────

interface VideoPoint {
  ts: number; // ms epoch
  atSec: number; // position in video
  kind: AnalyticsEvent["kind"];
}

interface WatchSegment {
  startSec: number;
  endSec: number;
}

interface Session {
  startedAt: number; // ms epoch
  endedAt: number;
  startSec: number;
  endSec: number;
  reachedEnd: boolean;
}

/** Parse video events into time-sorted points with a numeric atSec. */
function parseVideoPoints(events: AnalyticsEvent[]): VideoPoint[] {
  const out: VideoPoint[] = [];
  for (const ev of events) {
    if (
      ev.kind !== "video_play" &&
      ev.kind !== "video_progress" &&
      ev.kind !== "video_ended"
    ) {
      continue;
    }
    const p = ev.payload as Record<string, unknown> | null;
    const raw = p?.atSec;
    const atSec = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(atSec) || atSec < 0) continue;
    const ts = new Date(ev.ts).getTime();
    if (!Number.isFinite(ts)) continue;
    out.push({ ts, atSec, kind: ev.kind });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/**
 * Derive watched-second segments and play-sessions from the time-sorted
 * video points.
 *
 * Heuristic: between two consecutive points P1→P2, the user was watching if
 *   atSec2 > atSec1  AND  |dVideo - dWall| < 3s tolerance.
 * Otherwise the gap was a pause or a seek and we don't mark it as watched.
 *
 * Sessions: a video_play starts a new session; a session ends at the next
 * video_play, video_ended, or after a >2min wall-clock gap.
 */
function deriveCoverage(
  points: VideoPoint[],
  totalSec: number,
): { segments: WatchSegment[]; sessions: Session[]; coverageSec: number } {
  const segments: WatchSegment[] = [];
  const sessions: Session[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dVideo = b.atSec - a.atSec;
    const dWall = (b.ts - a.ts) / 1000;
    if (dVideo > 0 && Math.abs(dVideo - dWall) < 3) {
      segments.push({ startSec: a.atSec, endSec: b.atSec });
    }
  }

  // Group into sessions
  let cur: Session | null = null;
  for (const p of points) {
    if (cur === null) {
      cur = {
        startedAt: p.ts,
        endedAt: p.ts,
        startSec: p.atSec,
        endSec: p.atSec,
        reachedEnd: p.kind === "video_ended",
      };
      continue;
    }
    const gapSec = (p.ts - cur.endedAt) / 1000;
    if (p.kind === "video_play" || gapSec > 120) {
      sessions.push(cur);
      cur = {
        startedAt: p.ts,
        endedAt: p.ts,
        startSec: p.atSec,
        endSec: p.atSec,
        reachedEnd: p.kind === "video_ended",
      };
    } else {
      cur.endedAt = p.ts;
      cur.endSec = Math.max(cur.endSec, p.atSec);
      if (p.kind === "video_ended") cur.reachedEnd = true;
      // Allow position within session to extend even past initial endSec
      if (p.atSec > cur.endSec) cur.endSec = p.atSec;
    }
  }
  if (cur) sessions.push(cur);

  // Coverage seconds (union of watched ranges).
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
  let coverageSec = 0;
  let lastEnd = -1;
  for (const s of sorted) {
    const start = Math.max(s.startSec, lastEnd);
    if (s.endSec > start) {
      coverageSec += s.endSec - start;
      lastEnd = s.endSec;
    }
  }
  // Guard: if events exist but no continuous segment qualifies (e.g. only
  // a single video_play with no progress), credit the user with the highest
  // observed atSec — they at least started.
  if (coverageSec === 0 && points.length > 0) {
    coverageSec = Math.min(
      Math.max(...points.map((p) => p.atSec)),
      totalSec,
    );
  }
  coverageSec = Math.min(coverageSec, totalSec);

  return { segments, sessions, coverageSec };
}

/**
 * Per-pixel rewatch count map for the heatmap layer. Returns an array of
 * length `pxCount` with the number of times each pixel-bucket was watched.
 */
function rewatchMap(
  segments: WatchSegment[],
  totalSec: number,
  pxCount: number,
): number[] {
  const arr = new Array<number>(pxCount).fill(0);
  for (const seg of segments) {
    const a = Math.floor((seg.startSec / totalSec) * pxCount);
    const b = Math.ceil((seg.endSec / totalSec) * pxCount);
    for (let i = a; i < b && i < pxCount; i++) {
      if (i >= 0) arr[i] += 1;
    }
  }
  return arr;
}

interface EventMarker {
  atSec: number;
  ts: number;
  kind: "play" | "pause" | "seekback" | "end" | "cta";
  label: string;
}

/** Build the marker list (play / pause / seek-back / end). */
function deriveMarkers(points: VideoPoint[]): EventMarker[] {
  const markers: EventMarker[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.kind === "video_play") {
      markers.push({
        atSec: p.atSec,
        ts: p.ts,
        kind: "play",
        label: `Start bei ${formatWatchTime(p.atSec)}`,
      });
    } else if (p.kind === "video_ended") {
      markers.push({
        atSec: p.atSec,
        ts: p.ts,
        kind: "end",
        label: `Ende bei ${formatWatchTime(p.atSec)}`,
      });
    } else if (i > 0) {
      const prev = points[i - 1];
      const dVideo = p.atSec - prev.atSec;
      const dWall = (p.ts - prev.ts) / 1000;
      // Seek-back: video position dropped significantly
      if (dVideo < -3) {
        markers.push({
          atSec: p.atSec,
          ts: p.ts,
          kind: "seekback",
          label: `Zurückgespult auf ${formatWatchTime(p.atSec)}`,
        });
      }
      // Pause: wall-clock advanced but video didn't (within tolerance)
      else if (dWall > 8 && Math.abs(dVideo) < 1) {
        markers.push({
          atSec: p.atSec,
          ts: p.ts,
          kind: "pause",
          label: `Pause bei ${formatWatchTime(p.atSec)}`,
        });
      }
    }
  }
  return markers;
}

/**
 * The new "Engagement-Story" — replaces the previous abstract bucket
 * histogram with a self-explanatory video timeline that tells the *story*
 * of the lead's interaction:
 *
 *   - Single horizontal video bar (0:00 → end)
 *   - Filled in brand-color where watched (darker = rewatched)
 *   - Markers above with timing: play / pause / seek-back / end
 *   - CTA marker below positioned at video-time if clicked during play,
 *     or "nach Ende" pinned to the right if clicked after the video ended
 *   - Key insights above the chart: coverage %, drop-off, CTA timing
 *   - Compact session list below for quick "how many times did they watch"
 */
function EngagementStory({
  events,
  videoDurationSec,
}: {
  events: AnalyticsEvent[];
  videoDurationSec: number | null;
}) {
  const points = React.useMemo(() => parseVideoPoints(events), [events]);
  const maxAt = points.length > 0 ? Math.max(...points.map((p) => p.atSec)) : 0;
  const totalSec = Math.max(videoDurationSec ?? 0, Math.ceil(maxAt), 1);

  // CTA events with their timestamps (no atSec — we time-correlate)
  const ctaEvents = React.useMemo(
    () =>
      events
        .filter((e) => e.kind === "cta_click")
        .map((e) => ({ ts: new Date(e.ts).getTime(), payload: e.payload }))
        .filter((e) => Number.isFinite(e.ts))
        .sort((a, b) => a.ts - b.ts),
    [events],
  );

  if (points.length === 0 && !videoDurationSec) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Engagement-Verlauf
        </h3>
        <div className="rounded-squircle-sm bg-surface-soft px-3 py-6 text-center text-xs text-ink-muted">
          Sobald jemand das Video startet, erscheint hier der visuelle
          Engagement-Verlauf.
        </div>
      </div>
    );
  }

  const { segments, sessions, coverageSec } = deriveCoverage(points, totalSec);
  const markers = deriveMarkers(points);

  const coveragePct = Math.round((coverageSec / totalSec) * 100);
  const reachedEnd = sessions.some((s) => s.reachedEnd);
  const dropOffSec = reachedEnd
    ? null
    : sessions.length > 0
      ? Math.max(...sessions.map((s) => s.endSec))
      : null;

  // Correlate CTA clicks with the video-time at which they happened: if a
  // CTA fired during a play session, project its ts onto the session's atSec.
  // Otherwise mark "nach Ende".
  type CtaPlacement = { atSec: number | null; ts: number };
  const ctaPlacements: CtaPlacement[] = ctaEvents.map((c) => {
    for (const s of sessions) {
      if (c.ts >= s.startedAt && c.ts <= s.endedAt + 2000) {
        const dt = (c.ts - s.startedAt) / 1000;
        const projected = Math.min(s.endSec, s.startSec + dt);
        return { atSec: projected, ts: c.ts };
      }
    }
    return { atSec: null, ts: c.ts };
  });

  // Bullet-list of pithy insights — these are what the user actually skims.
  const insights: { label: string; tone: "good" | "warn" | "neutral" }[] = [];
  insights.push({
    label: `${coveragePct}% gesehen (${formatWatchTime(Math.round(coverageSec))} von ${formatWatchTime(totalSec)})`,
    tone: coveragePct >= 75 ? "good" : coveragePct >= 25 ? "neutral" : "warn",
  });
  if (reachedEnd) {
    insights.push({ label: "Video bis zum Ende geschaut", tone: "good" });
  } else if (dropOffSec !== null) {
    insights.push({
      label: `Drop-off bei ${formatWatchTime(Math.round(dropOffSec))}`,
      tone: "warn",
    });
  }
  insights.push({
    label: `${sessions.length} ${sessions.length === 1 ? "Session" : "Sessions"}`,
    tone: "neutral",
  });
  if (ctaPlacements.length > 0) {
    const inVideo = ctaPlacements.filter((c) => c.atSec !== null).length;
    if (inVideo === ctaPlacements.length) {
      insights.push({
        label:
          ctaPlacements.length === 1
            ? `CTA während Video bei ${formatWatchTime(Math.round(ctaPlacements[0].atSec!))}`
            : `${ctaPlacements.length} CTA-Klicks während Video`,
        tone: "good",
      });
    } else if (inVideo === 0) {
      insights.push({
        label: `${ctaPlacements.length} CTA-Klick${ctaPlacements.length === 1 ? "" : "s"} nach Video`,
        tone: "neutral",
      });
    } else {
      insights.push({
        label: `${ctaPlacements.length} CTA-Klicks (${inVideo} während, ${ctaPlacements.length - inVideo} danach)`,
        tone: "good",
      });
    }
  }

  // SVG geometry. We use a fairly wide viewBox so marker icons render at a
  // legible size while the whole thing still scales fluidly via class="w-full".
  const W = 400;
  const BAR_Y = 38;
  const BAR_H = 22;
  const MARKER_AREA_TOP = 8; // markers above the bar
  const CTA_AREA_TOP = BAR_Y + BAR_H + 4;
  const TOTAL_H = CTA_AREA_TOP + 22;
  const PX = 4; // horizontal padding so markers at the edges aren't clipped
  const innerW = W - PX * 2;

  const xOf = (sec: number): number =>
    PX + Math.min(1, Math.max(0, sec / totalSec)) * innerW;

  // Rewatch density: split the bar into N pixel-bins for color intensity.
  const PX_BINS = 80;
  const heat = rewatchMap(segments, totalSec, PX_BINS);
  const maxHeat = Math.max(1, ...heat);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Engagement-Verlauf
        </h3>
        <span className="text-[10px] text-ink-muted tabular-nums">
          Video {formatWatchTime(totalSec)}
        </span>
      </div>

      <div className="rounded-squircle-md bg-surface-soft p-4">
        {/* Insight pills — the at-a-glance summary the user actually reads */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {insights.map((ins, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
                ins.tone === "good"
                  ? "bg-ok-soft text-ok"
                  : ins.tone === "warn"
                    ? "bg-warn-soft text-warn"
                    : "bg-surface-muted text-ink-muted",
              )}
            >
              {ins.label}
            </span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${W} ${TOTAL_H}`}
          className="block w-full h-auto"
          role="img"
          aria-label="Engagement-Verlauf"
        >
          {/* ── Background track ── */}
          <rect
            x={PX}
            y={BAR_Y}
            width={innerW}
            height={BAR_H}
            rx={4}
            className="fill-surface-muted"
          />

          {/* ── Heat layer: every pixel-bin tinted by rewatch count ── */}
          {heat.map((count, i) => {
            if (count === 0) return null;
            const intensity = count / maxHeat;
            const x = PX + (i / PX_BINS) * innerW;
            const w = innerW / PX_BINS + 0.5;
            return (
              <rect
                key={i}
                x={x}
                y={BAR_Y}
                width={w}
                height={BAR_H}
                fill="#AA8CF5"
                opacity={0.35 + intensity * 0.6}
              />
            );
          })}

          {/* ── Drop-off marker (vertical accent line where they stopped) ── */}
          {dropOffSec !== null && (
            <line
              x1={xOf(dropOffSec)}
              x2={xOf(dropOffSec)}
              y1={BAR_Y - 2}
              y2={BAR_Y + BAR_H + 2}
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="2 2"
            >
              <title>Drop-off bei {formatWatchTime(Math.round(dropOffSec))}</title>
            </line>
          )}

          {/* ── Markers above bar (play / pause / seek-back / end) ── */}
          {markers.map((m, i) => {
            const x = xOf(m.atSec);
            const colour =
              m.kind === "play"
                ? "#10B981"
                : m.kind === "end"
                  ? "#3a36e0"
                  : m.kind === "seekback"
                    ? "#F59E0B"
                    : "#94A3B8";
            return (
              <g key={i}>
                {/* Tick from marker down to the bar */}
                <line
                  x1={x}
                  x2={x}
                  y1={MARKER_AREA_TOP + 10}
                  y2={BAR_Y}
                  stroke={colour}
                  strokeWidth={1}
                  opacity={0.5}
                />
                <circle
                  cx={x}
                  cy={MARKER_AREA_TOP + 6}
                  r={5}
                  fill={colour}
                >
                  <title>
                    {m.label} ·{" "}
                    {new Date(m.ts).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </title>
                </circle>
                <MarkerGlyph kind={m.kind} cx={x} cy={MARKER_AREA_TOP + 6} />
              </g>
            );
          })}

          {/* ── CTA markers below bar ── */}
          {ctaPlacements.map((c, i) => {
            const x = c.atSec !== null ? xOf(c.atSec) : W - PX - 4;
            return (
              <g key={i}>
                <line
                  x1={x}
                  x2={x}
                  y1={BAR_Y + BAR_H}
                  y2={CTA_AREA_TOP + 4}
                  stroke="#F59E0B"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <circle cx={x} cy={CTA_AREA_TOP + 10} r={5} fill="#F59E0B">
                  <title>
                    {c.atSec !== null
                      ? `CTA bei ${formatWatchTime(Math.round(c.atSec))} im Video`
                      : "CTA nach Video-Ende"}{" "}
                    ·{" "}
                    {new Date(c.ts).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </title>
                </circle>
                <text
                  x={x}
                  y={CTA_AREA_TOP + 13}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill="#fff"
                >
                  ✱
                </text>
              </g>
            );
          })}

          {/* ── Axis labels: 0, mid, end ── */}
          <g fontSize={9} fill="#94A3B8">
            <text x={PX} y={BAR_Y - 4} className="tabular-nums">
              0:00
            </text>
            <text
              x={W - PX}
              y={BAR_Y - 4}
              textAnchor="end"
              className="tabular-nums"
            >
              {formatWatchTime(totalSec)}
            </text>
          </g>
        </svg>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-muted">
          <LegendDot color="#10B981" label="Play" />
          <LegendDot color="#94A3B8" label="Pause" />
          <LegendDot color="#F59E0B" label="Seek / Drop-off" />
          <LegendDot color="#3a36e0" label="Ende" />
          <LegendDot color="#F59E0B" label="CTA" />
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-6 rounded"
              style={{
                background:
                  "linear-gradient(to right, #AA8CF5 0%, #AA8CF5 50%, #7C5CE8 100%)",
              }}
            />
            <span>einmal → mehrfach gesehen</span>
          </span>
        </div>

        {/* Sessions list — chronological breakdown */}
        {sessions.length > 0 && (
          <div className="mt-4 border-t border-line-soft pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
              Sessions
            </p>
            <ul className="space-y-1.5">
              {sessions.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex items-center gap-2 text-ink">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-deep tabular-nums">
                      {i + 1}
                    </span>
                    <span className="tabular-nums">
                      {formatWatchTime(s.startSec)} → {formatWatchTime(s.endSec)}
                      {s.reachedEnd && (
                        <span className="ml-1.5 text-ok">· bis Ende</span>
                      )}
                    </span>
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {new Date(s.startedAt).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny glyph rendered INSIDE the marker circle. SVG-native, no lucide. */
function MarkerGlyph({
  kind,
  cx,
  cy,
}: {
  kind: EventMarker["kind"];
  cx: number;
  cy: number;
}): React.JSX.Element | null {
  // Use simple shapes/letters so they render crisp at 5px radius.
  if (kind === "play") {
    return (
      <polygon
        points={`${cx - 1.6},${cy - 2.2} ${cx - 1.6},${cy + 2.2} ${cx + 2.4},${cy}`}
        fill="#fff"
      />
    );
  }
  if (kind === "end") {
    return (
      <rect
        x={cx - 1.8}
        y={cy - 1.8}
        width={3.6}
        height={3.6}
        rx={0.4}
        fill="#fff"
      />
    );
  }
  if (kind === "pause") {
    return (
      <>
        <rect x={cx - 1.6} y={cy - 2} width={1.2} height={4} fill="#fff" />
        <rect x={cx + 0.4} y={cy - 2} width={1.2} height={4} fill="#fff" />
      </>
    );
  }
  if (kind === "seekback") {
    return (
      <text
        x={cx}
        y={cy + 2.5}
        textAnchor="middle"
        fontSize={7}
        fontWeight={700}
        fill="#fff"
      >
        ↩
      </text>
    );
  }
  return null;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-2 rounded-full"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
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
      <ul className="divide-y divide-line-soft rounded-squircle-sm bg-surface-soft">
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
              {ev.kind === "form_submit" ? (
                <div className="mt-0.5 flex items-baseline justify-between gap-3">
                  <FormSubmitDetails payload={ev.payload} />
                  <span className="shrink-0 text-[10px] text-ink-muted tabular-nums">
                    {formatAbsolute(ev.ts)}
                  </span>
                </div>
              ) : (
                <div className="mt-0.5 flex items-baseline justify-between gap-3">
                  <span className="text-xs text-ink-muted truncate">
                    {payloadPreview(ev) ?? "—"}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-muted tabular-nums">
                    {formatAbsolute(ev.ts)}
                  </span>
                </div>
              )}
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
  if (kind === "form_submit") return <Mail className="size-3.5" />;
  return <span className="size-1.5 rounded-full bg-ink-muted" />;
}

/**
 * Detail-Block für Formular-Anfragen (kind `form_submit`): zeigt Name,
 * E-Mail, Telefon und Nachricht aus dem Payload gut lesbar untereinander.
 */
function FormSubmitDetails({ payload }: { payload: unknown }): React.JSX.Element {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const name = str(p.name);
  const email = str(p.email);
  const phone = str(p.phone);
  const message = str(p.message);
  return (
    <div className="min-w-0 space-y-0.5 text-xs text-ink-muted">
      {name && (
        <div className="truncate">
          <span className="font-medium text-ink">{name}</span>
        </div>
      )}
      {email && (
        <div className="truncate">
          E-Mail:{" "}
          <a href={`mailto:${email}`} className="text-brand-deep hover:underline">
            {email}
          </a>
        </div>
      )}
      {phone && <div className="truncate">Telefon: {phone}</div>}
      {message && (
        <div className="whitespace-pre-wrap break-words text-ink">{message}</div>
      )}
      {!name && !email && !phone && !message && <span>—</span>}
    </div>
  );
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
    case "form_submit":
      return "Formular-Anfrage";
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
            className="h-16 rounded-squircle-sm bg-surface-muted animate-pulse"
          />
        ))}
      </div>
      <div className="h-32 rounded-squircle-sm bg-surface-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-squircle-sm bg-surface-muted animate-pulse"
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
