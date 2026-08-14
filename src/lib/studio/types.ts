/**
 * Typen für die Studio-Aufnahme (Live-Regie).
 *
 * Konzept: docs/konzept-studio-modus.md. Der Nutzer legt Szenen („Tabs")
 * VOR der Aufnahme fest, nimmt EINMAL die Webcam auf und springt live
 * zwischen den Tabs / scrollt live. Aus dem Event-Log entstehen ganz
 * normale Segmente (`@/lib/segments/types`) — Editor und Worker brauchen
 * dafür keine Änderungen.
 *
 * Zeitbasis aller Events: `MediaRecorder.onstart` = t=0 (nicht der
 * `start()`-Aufruf — der hat 10–150 ms Browser-Latenz).
 */

import type {
  GDocsSegment,
  PdfSegment,
  Segment,
  WebsiteSegment,
} from "@/lib/segments/types";

/** Scroll-Sampling-Intervall im Studio (wie der bestehende Scroll-Recorder). */
export const STUDIO_SCROLL_SAMPLE_MS = 50;

/**
 * Eine Szene im Studio: ein vorbereitetes Segment (Draft), zwischen dem
 * der Nutzer während der Aufnahme live wechseln kann.
 */
export interface StudioTab {
  /** Stabile UUID der Szene (unabhängig von segment.id). */
  id: string;
  /** Segment-Draft, der als Render-/Vorschau-Quelle dient. */
  segment: Segment;
}

export interface StudioTabSwitchEvent {
  /** ms seit MediaRecorder.onstart. */
  t: number;
  type: "tabSwitch";
  tabId: string;
}

export interface StudioScrollEvent {
  /** ms seit MediaRecorder.onstart. */
  t: number;
  type: "scroll";
  tabId: string;
  /** Vertikale Scroll-Position 0..1 (Anteil der scrollbaren Höhe). */
  y: number;
}

/**
 * Nutzer startet die Wiedergabe einer Video-Szene (Klick auf Play).
 * Die Wiedergabe läuft, bis ein `mediaPause` für dieselbe Szene kommt,
 * die Szene gewechselt wird (implizite Pause) oder die Aufnahme endet.
 */
export interface StudioMediaPlayEvent {
  /** ms seit MediaRecorder.onstart. */
  t: number;
  type: "mediaPlay";
  tabId: string;
}

/** Nutzer pausiert die Wiedergabe einer Video-Szene. */
export interface StudioMediaPauseEvent {
  /** ms seit MediaRecorder.onstart. */
  t: number;
  type: "mediaPause";
  tabId: string;
}

export type StudioEvent =
  | StudioTabSwitchEvent
  | StudioScrollEvent
  | StudioMediaPlayEvent
  | StudioMediaPauseEvent;

/** Ein aus der Aufnahme abgeleitetes Segment inkl. Review-Metadaten. */
export interface DerivedStudioSegment {
  /** Fertiges Standard-Segment (neue UUID, durationMs/scrollFrames gesetzt). */
  segment: Segment;
  /** Aus welcher Szene dieses Segment stammt (Tab mehrfach besucht = mehrere). */
  tabId: string;
  /** Startzeit innerhalb des Webcam-Videos in ms. */
  startMs: number;
  /** Verdächtig kurz (versehentlicher Doppelklick?) — im Review markieren. */
  flagged: boolean;
}

export interface DeriveStudioSegmentsOptions {
  /**
   * Maßgebliche Gesamtdauer in ms (Server-ffprobe der hochgeladenen Webcam).
   * Ohne Angabe gilt die im Browser gemessene `recordedMs`.
   */
  totalMs?: number;
  /** Segmente kürzer als dieser Wert werden geflaggt (Default 1500 ms). */
  flagThresholdMs?: number;
}

/** Segment-Typen, die im Studio live gescrollt werden können. */
export type ScrollableStudioSegment = WebsiteSegment | GDocsSegment | PdfSegment;

export function isScrollableStudioSegment(
  s: Segment,
): s is ScrollableStudioSegment {
  return s.kind === "website" || s.kind === "gdocs" || s.kind === "pdf";
}
