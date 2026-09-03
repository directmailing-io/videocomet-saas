/**
 * Video-Abdeckung („wie viel der Zeitleiste wurde wirklich gesehen“).
 *
 * Fachliche Regel (Daniel, 2026-09-03): Die Zeitleiste ist 100 %. Wer 10 %
 * schaut, vorspult und weitere 10 % schaut, hat 20 % gesehen. Wiederholtes
 * Ansehen derselben Stelle zählt nicht doppelt. Das ist die „Abspielquote“
 * in allen Auswertungen.
 *
 * Bausteine:
 *  - `WatchAccumulator` (Client): sammelt gesehene Intervalle aus
 *    timeupdate-Ticks. Ein Sprung > SEEK_GAP_SEC zwischen zwei Ticks (Seek,
 *    Tab-Wechsel, Puffern) beendet das Intervall statt es zu strecken.
 *  - `mergeSegments` / `coverageSeconds`: Vereinigung der Intervalle.
 *  - `normalizeProgressPayload` (Server): liest alte (`atSec`/`duration`)
 *    und neue (`playedSec`/`durationSec`/`coveragePct`/`segments`)
 *    Payloads einheitlich.
 *
 * Wird sowohl im Browser (React-Player, ohne DOM-Abhängigkeit) als auch in
 * API/Aggregation genutzt. Die Custom-LP-Bridge (public/__videocomet-bridge.js)
 * enthält dieselbe Logik als ES5-Kopie, weil sie ohne Bundler ausgeliefert wird.
 */

export type WatchSegment = [start: number, end: number];

/** Sprung zwischen zwei Ticks, ab dem wir NICHT mehr von Wiedergabe ausgehen. */
export const SEEK_GAP_SEC = 2.5;
/** Mehr Segmente werden zusammengelegt (kleinste Lücken zuerst), damit Payloads klein bleiben. */
export const MAX_SEGMENTS = 40;
/** Maximale plausible Videolänge (Schutz vor Müll-Payloads). */
export const MAX_DURATION_SEC = 7200;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Sortiert, überlappende/berührende Intervalle vereinigt, Müll entfernt. */
export function mergeSegments(input: ReadonlyArray<WatchSegment>): WatchSegment[] {
  const clean = input
    .filter(
      (s) =>
        Array.isArray(s) &&
        s.length === 2 &&
        Number.isFinite(s[0]) &&
        Number.isFinite(s[1]) &&
        s[1] > s[0] &&
        s[0] >= 0 &&
        s[1] <= MAX_DURATION_SEC,
    )
    .map((s) => [s[0], s[1]] as WatchSegment)
    .sort((a, b) => a[0] - b[0]);
  const out: WatchSegment[] = [];
  for (const s of clean) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 0.05) {
      if (s[1] > last[1]) last[1] = s[1];
    } else {
      out.push([s[0], s[1]]);
    }
  }
  return out;
}

/** Bei zu vielen Segmenten die kleinsten Lücken schließen (leicht überschätzend). */
export function capSegments(segments: WatchSegment[], max: number = MAX_SEGMENTS): WatchSegment[] {
  let segs = mergeSegments(segments);
  while (segs.length > max) {
    let bestIdx = 0;
    let bestGap = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1][0] - segs[i][1];
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    segs[bestIdx] = [segs[bestIdx][0], segs[bestIdx + 1][1]];
    segs.splice(bestIdx + 1, 1);
    segs = mergeSegments(segs);
  }
  return segs;
}

export function coverageSeconds(segments: ReadonlyArray<WatchSegment>, durationSec?: number | null): number {
  const merged = mergeSegments(segments);
  let sum = 0;
  for (const [a, b] of merged) {
    const end = durationSec && durationSec > 0 ? Math.min(b, durationSec) : b;
    if (end > a) sum += end - a;
  }
  return round1(sum);
}

export function coveragePct(segments: ReadonlyArray<WatchSegment>, durationSec: number | null | undefined): number | null {
  if (!durationSec || durationSec <= 0) return null;
  const sec = coverageSeconds(segments, durationSec);
  return Math.max(0, Math.min(100, Math.round((sec / durationSec) * 100)));
}

export interface ProgressSnapshot {
  /** Aktuelle Position. */
  atSec: number;
  /** Einmalig gesehene Sekunden (Vereinigung aller Intervalle). */
  playedSec: number;
  /** Videolänge, 0 wenn unbekannt. */
  durationSec: number;
  /** Anteil der Zeitleiste in Prozent (0–100), null wenn Länge unbekannt. */
  coveragePct: number | null;
  /** Gesehene Intervalle, gerundet, zusammengeführt. */
  segments: WatchSegment[];
  /** Höchste je erreichte Position (für Quartil-Webhooks). */
  maxSec: number;
}

/**
 * Sammelt gesehene Intervalle aus Positions-Ticks. Framework-frei.
 *
 *   acc.tick(video.currentTime)   // bei jedem timeupdate
 *   acc.seek()                    // bei seeking/seeked: Intervall beenden
 *   acc.snapshot(video.duration)  // Payload fuer video_progress
 */
export class WatchAccumulator {
  private segments: WatchSegment[] = [];
  private openStart: number | null = null;
  private lastPos: number | null = null;
  private maxSec = 0;

  /** Neue Position waehrend der Wiedergabe. */
  tick(pos: number): void {
    if (!Number.isFinite(pos) || pos < 0) return;
    if (pos > this.maxSec) this.maxSec = pos;
    if (this.lastPos === null || this.openStart === null) {
      this.openStart = pos;
      this.lastPos = pos;
      return;
    }
    const delta = pos - this.lastPos;
    if (delta < 0 || delta > SEEK_GAP_SEC) {
      // Sprung: bisheriges Intervall abschliessen, neues beginnen.
      this.close();
      this.openStart = pos;
    }
    this.lastPos = pos;
  }

  /** Seek/Pause/Ende: offenes Intervall abschliessen. */
  close(): void {
    if (this.openStart !== null && this.lastPos !== null && this.lastPos > this.openStart) {
      this.segments.push([this.openStart, this.lastPos]);
      if (this.segments.length > MAX_SEGMENTS * 2) this.segments = capSegments(this.segments);
    }
    this.openStart = null;
    this.lastPos = null;
  }

  /** Alias fuer Lesbarkeit an Seek-Stellen. */
  seek(): void {
    this.close();
  }

  /** Video zu Ende: bis zur Laenge zaehlen. */
  ended(durationSec: number): void {
    if (Number.isFinite(durationSec) && durationSec > 0) {
      if (this.openStart !== null && this.lastPos !== null) {
        this.lastPos = Math.max(this.lastPos, durationSec);
      }
      if (durationSec > this.maxSec) this.maxSec = durationSec;
    }
    this.close();
  }

  snapshot(durationSecRaw: number | null | undefined, atSecRaw?: number | null): ProgressSnapshot {
    const durationSec =
      Number.isFinite(durationSecRaw as number) && (durationSecRaw as number) > 0
        ? round1(Math.min(durationSecRaw as number, MAX_DURATION_SEC))
        : 0;
    const all = [...this.segments];
    if (this.openStart !== null && this.lastPos !== null && this.lastPos > this.openStart) {
      all.push([this.openStart, this.lastPos]);
    }
    const segments = capSegments(all).map(([a, b]) => [round1(a), round1(b)] as WatchSegment);
    const playedSec = coverageSeconds(segments, durationSec || null);
    const atSec = round1(
      Number.isFinite(atSecRaw as number) && (atSecRaw as number) >= 0
        ? (atSecRaw as number)
        : (this.lastPos ?? this.maxSec),
    );
    return {
      atSec,
      playedSec,
      durationSec,
      coveragePct: durationSec > 0 ? coveragePct(segments, durationSec) : null,
      segments,
      maxSec: round1(this.maxSec),
    };
  }
}

// ── Server-Seite: Payloads alter und neuer Clients einheitlich lesen ─────

export interface NormalizedProgress {
  atSec: number | null;
  durationSec: number | null;
  /** Einmalig gesehene Sekunden; bei alten Payloads = atSec (Näherung). */
  playedSec: number | null;
  /** 0–100 oder null. */
  coveragePct: number | null;
  segments: WatchSegment[] | null;
}

function num(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

export function normalizeProgressPayload(payload: Record<string, unknown> | null | undefined): NormalizedProgress {
  const p = payload ?? {};
  const atSec = num(p.atSec, MAX_DURATION_SEC);
  const durationSec = num(p.durationSec, MAX_DURATION_SEC) ?? num(p.duration, MAX_DURATION_SEC);
  let segments: WatchSegment[] | null = null;
  if (Array.isArray(p.segments)) {
    segments = mergeSegments(
      (p.segments as unknown[])
        .filter((s): s is [unknown, unknown] => Array.isArray(s) && s.length === 2)
        .map((s) => [Number(s[0]), Number(s[1])] as WatchSegment)
        .filter((s) => Number.isFinite(s[0]) && Number.isFinite(s[1])),
    );
    if (segments.length === 0) segments = null;
  }
  let playedSec = num(p.playedSec, MAX_DURATION_SEC);
  if (playedSec === null && segments) playedSec = coverageSeconds(segments, durationSec);
  if (playedSec === null) playedSec = atSec; // Legacy: Position als Näherung
  let cov = num(p.coveragePct, 100);
  if (cov === null && segments && durationSec) cov = coveragePct(segments, durationSec);
  if (cov === null && playedSec !== null && durationSec && durationSec > 0) {
    cov = Math.max(0, Math.min(100, Math.round((playedSec / durationSec) * 100)));
  }
  return {
    atSec,
    durationSec,
    playedSec,
    coveragePct: cov === null ? null : Math.round(cov),
    segments,
  };
}

/**
 * Serverseitige Bereinigung eines eingehenden video_progress/video_ended-
 * Payloads: nur bekannte Felder, plausible Bereiche, Segmente begrenzt.
 */
export function sanitizeProgressPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const n = normalizeProgressPayload(payload);
  const out: Record<string, unknown> = {};
  if (n.atSec !== null) out.atSec = round1(n.atSec);
  if (n.durationSec !== null) out.durationSec = round1(n.durationSec);
  if (n.playedSec !== null) out.playedSec = round1(n.playedSec);
  if (n.coveragePct !== null) out.coveragePct = n.coveragePct;
  if (n.segments) out.segments = capSegments(n.segments).map(([a, b]) => [round1(a), round1(b)]);
  const maxSec = num(payload.maxSec, MAX_DURATION_SEC);
  if (maxSec !== null) out.maxSec = round1(maxSec);
  return out;
}
