/**
 * Einheitliche Beschriftung und Verdichtung von Video-Events in Chronologien
 * (Aktivität-Drawer, Kontakt-Detail, Export).
 *
 * Problem vorher: alle 5 Sekunden ein Eintrag „Video gesehen 34 %, 39 %, …“
 * → 20 Zeilen pro Ansehen. Jetzt: ein Eintrag pro Sitzung mit dem
 * Endstand („Video angesehen: 96 %“), der bei jedem neuen Tick steigt.
 * Prozent = einmalig gesehene Abdeckung (coveragePct), bei alten Events
 * die Position im Video (atSec/duration).
 */

import { normalizeProgressPayload } from "@/lib/analytics/watch-coverage";

export interface ChronoEvent {
  eventId: string;
  ts: string;
  kind: string;
  payload: Record<string, unknown> | null;
}

/** Prozentwert eines Fortschritts-Events (0–100) oder null. */
export function progressPercent(payload: Record<string, unknown> | null | undefined): number | null {
  const n = normalizeProgressPayload(payload ?? undefined);
  return n.coveragePct;
}

/** Kurzlabel fuer ein einzelnes Fortschritts-Event. */
export function progressLabel(payload: Record<string, unknown> | null | undefined): string {
  const n = normalizeProgressPayload(payload ?? undefined);
  if (n.coveragePct !== null) return `Video gesehen ${n.coveragePct} %`;
  if (n.atSec !== null) return `Video bei ${Math.round(n.atSec)} s`;
  return "Video angesehen";
}

const VIDEO_KINDS = new Set(["video_play", "video_progress", "video_ended"]);
/** Neue Sitzung, wenn zwischen zwei Video-Events mehr Zeit liegt. */
const SESSION_GAP_MS = 5 * 60 * 1000;

export interface CollapsedVideoEvent extends ChronoEvent {
  kind: "video_session";
  /** Endstand in Prozent (0–100) oder null. */
  pct: number | null;
  /** Anzahl zusammengefasster Roh-Events. */
  count: number;
  /** Bis zum Ende gesehen? */
  ended: boolean;
  /** Beginn der Sitzung (ts des ersten Events). */
  startedAt: string;
}

/**
 * Verdichtet Video-Events (play/progress/ended) zu einem Eintrag je
 * Sitzung. Andere Events bleiben unveraendert. Eingabe: beliebig sortiert,
 * Ausgabe: absteigend nach Zeit (neueste zuerst), wie die Chronologie.
 */
export function collapseVideoEvents<T extends ChronoEvent>(events: T[]): Array<T | CollapsedVideoEvent> {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const out: Array<T | CollapsedVideoEvent> = [];
  let current: CollapsedVideoEvent | null = null;

  const flush = () => {
    if (current) out.push(current);
    current = null;
  };

  for (const ev of sorted) {
    if (!VIDEO_KINDS.has(ev.kind)) {
      // Nicht-Video-Event: laufende Sitzung bleibt offen (ein CTA-Klick
      // waehrend des Videos soll die Sitzung nicht zerschneiden).
      out.push(ev);
      continue;
    }
    const ts = new Date(ev.ts).getTime();
    const gap = current ? ts - new Date(current.ts).getTime() : Infinity;
    const explicitNewSession = ev.kind === "video_play" && current !== null && current.ended;
    if (!current || gap > SESSION_GAP_MS || explicitNewSession) {
      flush();
      current = {
        eventId: ev.eventId,
        ts: ev.ts,
        kind: "video_session",
        payload: ev.payload,
        pct: null,
        count: 0,
        ended: false,
        startedAt: ev.ts,
      };
    }
    const pct = ev.kind === "video_play" ? null : progressPercent(ev.payload);
    current.count += 1;
    current.ts = ev.ts; // Sitzung endet mit dem letzten Event
    current.eventId = ev.eventId;
    current.payload = ev.payload ?? current.payload;
    if (pct !== null) current.pct = Math.max(current.pct ?? 0, pct);
    if (ev.kind === "video_ended") {
      current.ended = true;
      current.pct = Math.max(current.pct ?? 0, progressPercent(ev.payload) ?? current.pct ?? 0);
    }
  }
  flush();
  return out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

/** Beschriftung einer verdichteten Video-Sitzung. */
export function collapsedVideoLabel(ev: CollapsedVideoEvent): string {
  if (ev.ended) return ev.pct !== null && ev.pct < 100 ? `Video zu Ende gesehen (${ev.pct} % der Zeitleiste)` : "Video komplett gesehen";
  if (ev.pct !== null) return `Video angesehen: ${ev.pct} %`;
  return "Video gestartet";
}
