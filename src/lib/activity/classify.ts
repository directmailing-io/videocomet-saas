/**
 * Lead-Temperature Klassifikation.
 *
 * Reine, deterministische Funktion: dieselbe Event-Liste liefert immer
 * dasselbe Label. Wird sowohl on-the-fly im Feed (per Lead-Aggregat) als
 * auch im Export benutzt — die Logik MUSS daher seiteneffektfrei bleiben
 * und ohne DB-Zugriff auskommen.
 *
 * Reihenfolge der Regel-Auswertung ist relevant — die spezifischeren Labels
 * stehen oben und gewinnen.
 */

import type { LeadTemperature } from "./types";

/** Minimaler Event-Shape, den die Klassifikation pro Event braucht. */
export interface ClassifyEvent {
  kind: string;
  ts: Date | string;
  sessionId?: string | null;
  payload?: Record<string, unknown> | null;
}

const HOT_PROGRESS_THRESHOLD = 75;

function readProgressPct(payload: Record<string, unknown> | null | undefined): number | null {
  if (!payload || typeof payload !== "object") return null;
  // The bridge uses `atSec` + `duration` rather than a direct percent;
  // we accept both to stay forward-compatible.
  const direct = payload["pct"];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct > 1 ? direct : direct * 100;
  }
  const atSec = payload["atSec"];
  const duration = payload["duration"] ?? payload["durationSec"];
  if (
    typeof atSec === "number" &&
    typeof duration === "number" &&
    duration > 0
  ) {
    return (atSec / duration) * 100;
  }
  return null;
}

/**
 * Map an event-history to one of:
 *   inactive — 0 events
 *   cold     — only page_view events
 *   warm     — at least one video_play OR visits across ≥2 distinct sessions
 *   hot      — at least one cta_click OR ≥75 % video progress
 *
 * Only relies on events that EVERY landingpage variant actually emits
 * (page_view, video_play, video_progress, video_ended, cta_click) — the
 * block-based landingpages never send cta_hover/scroll_depth etc., so those
 * must not influence the label.
 */
export function classifyLead(events: ClassifyEvent[]): LeadTemperature {
  if (events.length === 0) return "inactive";

  let hasPageView = false;
  let hasVideoPlay = false;
  let maxProgressPct = 0;
  let hasCtaClick = false;
  const sessions = new Set<string>();

  for (const ev of events) {
    if (ev.sessionId) sessions.add(ev.sessionId);
    switch (ev.kind) {
      case "page_view":
        hasPageView = true;
        break;
      case "video_play":
        hasVideoPlay = true;
        break;
      case "video_progress":
      case "video_ended": {
        const pct = readProgressPct(ev.payload ?? null);
        if (pct !== null && pct > maxProgressPct) maxProgressPct = pct;
        break;
      }
      case "cta_click":
        hasCtaClick = true;
        break;
      default:
        // unknown kinds are ignored — keeps classification stable when the
        // bridge ships new event types ahead of this module.
        break;
    }
  }

  if (hasCtaClick || maxProgressPct >= HOT_PROGRESS_THRESHOLD) return "hot";
  if (hasVideoPlay || sessions.size >= 2) return "warm";
  if (hasPageView) return "cold";
  return "inactive";
}

/**
 * Lightweight classification straight off the denormalised aggregates that
 * already live on the `leads` row. Useful for feed-rendering where we don't
 * want to fetch the entire event history per row.
 *
 * NOTE: this is an APPROXIMATION — it cannot detect the session count.
 * Callers that need the exact label should fetch events and use
 * `classifyLead`.
 */
export interface LeadAggregateInput {
  pageViewCount: number;
  playCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  /** max progress (0..100). If unknown, leave null. */
  maxProgressPct?: number | null;
  /** number of distinct sessions; defaults to 1 if unknown. */
  sessionCount?: number;
}

export function classifyLeadFromAggregates(agg: LeadAggregateInput): LeadTemperature {
  const sessions = agg.sessionCount ?? 1;
  const maxPct = agg.maxProgressPct ?? 0;
  if (agg.ctaClickCount > 0 || maxPct >= HOT_PROGRESS_THRESHOLD) return "hot";
  if (agg.playCount > 0 || sessions >= 2) return "warm";
  if (agg.pageViewCount > 0) return "cold";
  return "inactive";
}
