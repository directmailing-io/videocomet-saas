/**
 * Ableitung der Segment-Timeline aus dem Studio-Event-Log.
 *
 * Kernregeln (siehe docs/konzept-studio-modus.md):
 * - Segment-Dauer = Zeit zwischen Tab-Wechseln; der erste Wechsel wird auf
 *   t=0 geklemmt, Folge-Wechsel auf denselben Tab werden ignoriert.
 * - Die Server-ffprobe-Dauer (`totalMs`) ist maßgeblich: Abweichung ≤1 s
 *   wird auf das letzte Segment gebucht, größere Abweichungen werden
 *   proportional auf alle Event-Zeiten skaliert. Invariante:
 *   Σ Segmentdauern == totalMs (Webcam wird nie geschnitten).
 * - Scroll-Position wird pro Tab über die gesamte Timeline gemerkt —
 *   zweiter Besuch startet dort, wo der erste aufgehört hat.
 * - ScrollFrames pro Segment sind auf den Segment-Start renormiert und
 *   beginnen immer bei t=0 (Format identisch zum bestehenden
 *   Scroll-Recorder → `buildScrollPlanFromFrames` im Worker unverändert).
 */

import type { ScrollFrame, Segment } from "@/lib/segments/types";
import {
  isScrollableStudioSegment,
  type DerivedStudioSegment,
  type DeriveStudioSegmentsOptions,
  type StudioEvent,
  type StudioTab,
} from "./types";

const DEFAULT_FLAG_THRESHOLD_MS = 1500;
/** Ab dieser ffprobe-Abweichung wird proportional skaliert. */
const PROPORTIONAL_DELTA_MS = 1000;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function deriveStudioSegments(
  tabs: StudioTab[],
  events: StudioEvent[],
  recordedMs: number,
  opts?: DeriveStudioSegmentsOptions,
): DerivedStudioSegment[] {
  const flagThresholdMs = opts?.flagThresholdMs ?? DEFAULT_FLAG_THRESHOLD_MS;
  let recorded = Math.round(recordedMs);
  const totalMs = Math.round(opts?.totalMs ?? recorded);
  if (totalMs <= 0 || tabs.length === 0) return [];
  // Client-Uhr versagt (z. B. onstop ohne vorherigen stop()-Aufruf, wenn ein
  // Track endet) → die maßgebliche Server-ffprobe-Dauer ist trotzdem gültig.
  // Ohne diesen Fallback ginge die komplette Aufnahme verloren.
  if (recorded <= 0) recorded = totalMs;

  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const sorted = [...events]
    .filter((e) => tabById.has(e.tabId))
    .sort((a, b) => a.t - b.t);

  // Tab-Wechsel extrahieren: erster auf t=0 geklemmt, gleiche-Tab-Folgen
  // ignoriert, Wechsel nach Aufnahme-Ende verworfen.
  let switches: { t: number; tabId: string }[] = [];
  for (const e of sorted) {
    if (e.type !== "tabSwitch") continue;
    const t = Math.max(0, e.t);
    if (t >= recorded) continue;
    const prev = switches[switches.length - 1];
    if (prev && prev.tabId === e.tabId) continue;
    switches.push({ t, tabId: e.tabId });
  }
  if (switches.length === 0) switches = [{ t: 0, tabId: tabs[0].id }];
  switches[0] = { ...switches[0], t: 0 };

  // Dauerabgleich mit der maßgeblichen ffprobe-Dauer.
  const delta = totalMs - recorded;
  let scale = 1;
  let lastAdjust = 0;
  if (Math.abs(delta) > PROPORTIONAL_DELTA_MS) {
    scale = totalMs / recorded;
  } else if (delta !== 0) {
    const lastStart = Math.round(switches[switches.length - 1].t);
    if (recorded - lastStart + delta >= 1) {
      lastAdjust = delta;
    } else {
      // Delta würde das letzte Segment auslöschen → doch proportional.
      scale = totalMs / recorded;
    }
  }

  const boundaries = switches.map((s) => Math.round(s.t * scale));
  boundaries[0] = 0;
  const endMs = scale === 1 ? recorded : totalMs;

  const lastY = new Map<string, number>();
  const result: DerivedStudioSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < switches.length; i++) {
    const start = boundaries[i];
    const rawEnd = i + 1 < switches.length ? boundaries[i + 1] : endMs;
    let durationMs = rawEnd - start;
    if (i === switches.length - 1) durationMs += lastAdjust;
    if (durationMs <= 0) continue;

    const tab = tabById.get(switches[i].tabId)!;
    const startY = clamp01(lastY.get(tab.id) ?? 0);

    // ScrollFrames dieses Intervalls, renormiert auf den Segment-Start.
    const frames: ScrollFrame[] = [{ t: 0, y: startY }];
    for (const e of sorted) {
      if (e.type !== "scroll" || e.tabId !== tab.id) continue;
      const t = Math.round(e.t * scale);
      if (t < start || t >= rawEnd) continue;
      const rel = t - start;
      if (rel === 0) frames[0] = { t: 0, y: clamp01(e.y) };
      else frames.push({ t: rel, y: clamp01(e.y) });
    }
    lastY.set(tab.id, frames[frames.length - 1].y);

    const segment = structuredClone(tab.segment);
    segment.id = crypto.randomUUID();
    segment.durationMs = durationMs;
    if (isScrollableStudioSegment(segment)) {
      const moved = frames.some((f) => f.y !== frames[0].y);
      if (moved || frames[0].y > 0) {
        segment.captureMode = "scroll-recorded";
        segment.scrollFrames = frames;
      } else {
        segment.captureMode = "static-hero";
        delete segment.scrollFrames;
      }
    }

    result.push({
      segment,
      tabId: tab.id,
      startMs: cursor,
      flagged: durationMs < flagThresholdMs,
    });
    cursor += durationMs;
  }

  return result;
}

/**
 * Entfernt ein abgeleitetes Segment im Review („Versehen"-Chip).
 *
 * Die Webcam wird nie geschnitten — die Dauer des entfernten Segments
 * wandert zum Vorgänger (bzw. beim ersten Segment zum Nachfolger, dessen
 * ScrollFrames dann nach hinten verschoben werden, damit sie synchron
 * zur Webcam bleiben). `startMs` wird für alle neu berechnet.
 */
export function removeDerivedSegment(
  list: DerivedStudioSegment[],
  index: number,
  opts?: { flagThresholdMs?: number },
): DerivedStudioSegment[] {
  if (index < 0 || index >= list.length) return list;
  if (list.length === 1) return [];
  const flagThresholdMs = opts?.flagThresholdMs ?? DEFAULT_FLAG_THRESHOLD_MS;

  const removedMs = list[index].segment.durationMs;
  const next = list
    .filter((_, i) => i !== index)
    .map((d) => ({ ...d, segment: structuredClone(d.segment) }));

  const receiver = next[index > 0 ? index - 1 : 0];
  if (index === 0) {
    // Nachfolger übernimmt die Zeit vorn → Frames nach hinten schieben
    // (interpolateScrollRatio hält vor dem ersten Frame dessen y).
    if (
      isScrollableStudioSegment(receiver.segment) &&
      receiver.segment.scrollFrames
    ) {
      receiver.segment.scrollFrames = receiver.segment.scrollFrames.map(
        (f) => ({ t: f.t + removedMs, y: f.y }),
      );
    }
  }
  receiver.segment.durationMs += removedMs;
  receiver.flagged = receiver.segment.durationMs < flagThresholdMs;

  let cursor = 0;
  for (const d of next) {
    d.startMs = cursor;
    cursor += d.segment.durationMs;
  }
  return next;
}
