"use client";

import * as React from "react";
import type { ActivityFeedRow, ActivityCounts } from "../activity-center";

/**
 * SSE-Hook: verbindet zu `/api/activity/stream?<filters>` und liefert
 *   - aktuellen Connection-State (live/connecting/error)
 *   - eingehende append-Rows (eine Queue, vom Caller per `drain()` ge-leert)
 *   - patch-Counts (letzte server-pushed Counts)
 *
 * Wir registrieren NUR die zwei Event-Names die im Vertrag stehen:
 *   - "append"  → ActivityFeedRow JSON-payload
 *   - "counts"  → ActivityCounts JSON-payload
 *   - "ping"    → ignoriert, dient nur als Keep-Alive
 *
 * Auto-Reconnect: EventSource macht das vom Browser aus, wir markieren
 * den Status aber als "connecting" wenn onerror feuert (vor dem nächsten
 * onopen). Bei unmount oder Filter-Wechsel schließen wir die Verbindung.
 */
export type StreamState = "connecting" | "live" | "error" | "off";

export interface UseActivityStreamOptions {
  /** Vollständiger Query-String der bereits encoded ist (ohne führendes ?). */
  queryString: string;
  /** Wenn false, wird KEINE Verbindung geöffnet — z.B. bei Auth-Loading. */
  enabled?: boolean;
  /** Callback für jeden append-Row — Caller kann selbst entscheiden ob er ihn fade-in zeigt. */
  onAppend?: (row: ActivityFeedRow) => void;
  /** Callback für counts-Updates. */
  onCounts?: (counts: ActivityCounts) => void;
}

export interface UseActivityStreamResult {
  state: StreamState;
  /** Versuche neu zu verbinden — nützlich für „Wiederherstellen"-Buttons. */
  reconnect: () => void;
}

export function useActivityStream({
  queryString,
  enabled = true,
  onAppend,
  onCounts,
}: UseActivityStreamOptions): UseActivityStreamResult {
  const [state, setState] = React.useState<StreamState>("off");
  const [bumper, setBumper] = React.useState(0);

  // Refs auf die jüngsten Callbacks → wir wollen NICHT bei jedem Callback-
  // Wechsel die EventSource neu aufbauen.
  const onAppendRef = React.useRef(onAppend);
  const onCountsRef = React.useRef(onCounts);
  onAppendRef.current = onAppend;
  onCountsRef.current = onCounts;

  React.useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    // Debounced error-state: EventSource feuert `error` auch bei transienten
    // Reconnects. Wir setzen state="error" NUR wenn nach 3s kein open kam.
    let errorTimeout: ReturnType<typeof setTimeout> | null = null;
    const clearErrorTimeout = () => {
      if (errorTimeout) {
        clearTimeout(errorTimeout);
        errorTimeout = null;
      }
    };

    setState((prev) => (prev === "live" ? "live" : "connecting"));

    try {
      const url = `/api/activity/stream${queryString ? `?${queryString}` : ""}`;
      es = new EventSource(url, { withCredentials: true });

      es.addEventListener("open", () => {
        if (cancelled) return;
        clearErrorTimeout();
        setState("live");
      });

      es.addEventListener("error", () => {
        if (cancelled) return;
        // Setze state NICHT sofort auf "error" — EventSource versucht
        // selbständig zu rebinden. Erst nach 3s ohne open ist es echt tot.
        if (errorTimeout) return;
        errorTimeout = setTimeout(() => {
          if (cancelled) return;
          setState("error");
          errorTimeout = null;
        }, 3000);
      });

      es.addEventListener("append", (ev) => {
        if (cancelled) return;
        // Append-event ist ein impliziter Heartbeat — Stream lebt.
        clearErrorTimeout();
        if (state !== "live") setState("live");
        try {
          const row = JSON.parse((ev as MessageEvent).data) as ActivityFeedRow;
          onAppendRef.current?.(row);
        } catch {
          // payload kaputt → ignorieren, nächste Nachricht zählt
        }
      });

      es.addEventListener("counts", (ev) => {
        if (cancelled) return;
        clearErrorTimeout();
        try {
          const counts = JSON.parse((ev as MessageEvent).data) as ActivityCounts;
          onCountsRef.current?.(counts);
        } catch {
          // ignorieren
        }
      });

      // ping → kein Handler nötig, EventSource updated onmessage nicht da
      // wir nur named events nutzen.
    } catch {
      setState("error");
    }

    return () => {
      cancelled = true;
      clearErrorTimeout();
      es?.close();
      // KEIN setState("off") — Filter-Wechsel soll nicht "Getrennt" zeigen.
      // Der nächste Effect-Run setzt sofort wieder "connecting".
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, enabled, bumper]);

  const reconnect = React.useCallback(() => {
    setBumper((n) => n + 1);
  }, []);

  return { state, reconnect };
}
