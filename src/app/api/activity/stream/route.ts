/**
 * GET /api/activity/stream — Server-Sent Events für das Aktivitäts-Center.
 *
 * Implementierung:
 *  - Beim Verbindungsaufbau: ein erster `getActivityFeed`-Snapshot, der NICHT
 *    an den Client gepushed wird (Client hat seinen initialen Feed bereits
 *    via /api/activity/feed). Die enthaltenen Event-IDs landen im
 *    `seen`-Set, damit der erste Diff-Tick nur echte Neuzugänge meldet.
 *  - Alle 2 s: erneuter Feed-Pull. Neue Rows (id nicht in `seen`) werden als
 *    `event: append` einzeln pushed. IDs werden in `seen` gemerkt.
 *  - Alle 5 s: `getActivityCounts` → `event: counts`.
 *  - 30 s ohne Append: `event: ping`-Heartbeat, damit Proxies & Browser die
 *    Verbindung nicht killen.
 *  - 5 min ohne Append: Stream schließen (Backend-seitiges Idle-Timeout —
 *    Client reconnected dann eigenständig via EventSource).
 *  - Bei Client-Disconnect (cancel): alle Timer abräumen.
 *
 * Trade-off: 2s-Polling hält die Implementierung simpel & vermeidet einen
 * Pub/Sub-Listener auf Postgres. Für 5–7 Kunden völlig ausreichend.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { parseFilters } from "@/lib/activity/filter-parser";
import {
  getActivityCounts,
  getActivityFeed,
} from "@/lib/db/queries/activity";
import type { ActivityCounts, ActivityFilters } from "@/lib/activity/types";

const APPEND_POLL_MS = 2_000;
const COUNTS_POLL_MS = 5_000;
const PING_AFTER_MS = 30_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;
// Pro Tick maximal so viele neue Rows pushen, damit ein Bulk-Insert die SSE
// Connection nicht flutet. Reicht für realistische Burst-Lasten.
const MAX_APPENDS_PER_TICK = 100;

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = parseFilters(req.nextUrl.searchParams, auth.user.id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const filters: ActivityFilters = parsed;
  const userId = auth.user.id;

  const encoder = new TextEncoder();
  const seen = new Set<string>();
  let lastAppendAt = Date.now();
  let closed = false;

  const appendTimer: { id: ReturnType<typeof setInterval> | null } = {
    id: null,
  };
  const countsTimer: { id: ReturnType<typeof setInterval> | null } = {
    id: null,
  };
  const pingTimer: { id: ReturnType<typeof setInterval> | null } = {
    id: null,
  };
  const idleTimer: { id: ReturnType<typeof setInterval> | null } = {
    id: null,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          shutdown();
          return false;
        }
      };

      const sendEvent = (event: string, data: unknown): boolean => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        return safeEnqueue(payload);
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (appendTimer.id) clearInterval(appendTimer.id);
        if (countsTimer.id) clearInterval(countsTimer.id);
        if (pingTimer.id) clearInterval(pingTimer.id);
        if (idleTimer.id) clearInterval(idleTimer.id);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Hello-Comment: signals the connection is open & flushes proxy buffers.
      safeEnqueue(": connected\n\n");

      // ── Prime `seen` mit aktuellem Feed (kein Push an Client) ───────────
      try {
        const initial = await getActivityFeed(userId, filters);
        for (const row of initial.rows) seen.add(row.eventId);
      } catch (err) {
        sendEvent("error", {
          message:
            err instanceof Error ? err.message : "Initialer Feed fehlgeschlagen.",
        });
        shutdown();
        return;
      }

      const tickAppend = async () => {
        if (closed) return;
        try {
          // `to` auf JETZT bumpen — sonst werden Events, die NACH dem
          // SSE-Verbindungs-Aufbau eintreffen, vom Server-Filter
          // ausgeschlossen. Der User müsste die Seite reloaden um neue
          // Aktivitäten zu sehen.
          filters.to = new Date();
          const feed = await getActivityFeed(userId, filters);
          let appended = 0;
          // Reverse: älteste neue Row zuerst, damit der Client chronologisch
          // appended (UI rendert top-down ohne Re-Sort).
          for (let i = feed.rows.length - 1; i >= 0; i--) {
            const row = feed.rows[i];
            if (!row) continue;
            if (seen.has(row.eventId)) continue;
            seen.add(row.eventId);
            const ok = sendEvent("append", { row });
            if (!ok) return;
            appended++;
            if (appended >= MAX_APPENDS_PER_TICK) break;
          }
          if (appended > 0) lastAppendAt = Date.now();
          // Prevent unbounded growth: cap seen-set at 10k. Älteste IDs werden
          // implizit über die Feed-Window-Begrenzung sowieso nicht mehr
          // auftauchen — die Sicherheits-Cap ist nur ein Schutz vor Memory-
          // Leak bei sehr langlebigen Verbindungen.
          if (seen.size > 10_000) {
            const trimmed = Array.from(seen).slice(-5_000);
            seen.clear();
            for (const id of trimmed) seen.add(id);
          }
        } catch (err) {
          sendEvent("error", {
            message:
              err instanceof Error ? err.message : "Feed-Polling fehlgeschlagen.",
          });
          // Soft: keep stream alive; transient DB blips shouldn't kill SSE.
        }
      };

      const tickCounts = async () => {
        if (closed) return;
        try {
          // Wie in tickAppend: `to` auf JETZT bumpen damit live
          // angekommene Events in den Counts auftauchen.
          filters.to = new Date();
          const counts: ActivityCounts = await getActivityCounts(
            userId,
            filters,
          );
          sendEvent("counts", counts);
        } catch {
          // Soft: same rationale as append.
        }
      };

      const tickPing = () => {
        if (closed) return;
        const since = Date.now() - lastAppendAt;
        if (since >= PING_AFTER_MS) {
          sendEvent("ping", {});
        }
      };

      const tickIdle = () => {
        if (closed) return;
        const since = Date.now() - lastAppendAt;
        if (since >= IDLE_TIMEOUT_MS) {
          shutdown();
        }
      };

      appendTimer.id = setInterval(() => {
        void tickAppend();
      }, APPEND_POLL_MS);
      countsTimer.id = setInterval(() => {
        void tickCounts();
      }, COUNTS_POLL_MS);
      pingTimer.id = setInterval(tickPing, PING_AFTER_MS);
      idleTimer.id = setInterval(tickIdle, 30_000);

      // Client disconnect — Next.js signals via AbortSignal.
      req.signal.addEventListener("abort", shutdown);
    },
    cancel() {
      closed = true;
      if (appendTimer.id) clearInterval(appendTimer.id);
      if (countsTimer.id) clearInterval(countsTimer.id);
      if (pingTimer.id) clearInterval(pingTimer.id);
      if (idleTimer.id) clearInterval(idleTimer.id);
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

