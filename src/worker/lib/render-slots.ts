/**
 * Globaler Video-Render-Slot-Limiter (Phase 0, Skalierungs-Paket 2026-08-19).
 *
 * Problem (Vorfall 2026-08-19, Run 713395a6): WORKER_CONCURRENCY=24 lässt
 * bis zu 24 Leads gleichzeitig in die videoRender-Stage. Jeder
 * with-presentation-Render öffnet Chromium-Seiten (Scroll-Capture 30fps)
 * plus ffmpeg — bei 15 parallelen Leads lagen 54 Chromium-Prozesse an und
 * die Load stieg auf 10,7 (8 Kerne). Renderings, die normal 60–120s
 * brauchen, rissen das 300s-Stage-Timeout, die Retries liefen in dieselbe
 * Überlast → ganze Runde failed.
 *
 * Lösung: prozessweite FIFO-Semaphore NUR um die videoRender-Stage für
 * with-presentation-Leads (webcam-only rendert ohne Chromium und bleibt
 * ungedrosselt). Gemessen verkraftet der 8-vCPU-Host ~6–8 parallele
 * Capture-Renders — Default 6. Die Slot-Wartezeit läuft bewusst VOR dem
 * Stage-Timeout (pipeline.ts), damit Warten nie als Timeout zählt.
 * Dadurch sind auch Retries automatisch lastbewusst: sie warten auf einen
 * freien Slot statt in die Überlast zu stürmen.
 *
 * Env-Override: MAX_CONCURRENT_RENDERS (z. B. 12 auf einem 16-Kern-Host).
 * Muster identisch zu encode-limiter.ts (withEncodeSlot).
 */

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

const MAX_CONCURRENT_RENDERS = envInt("MAX_CONCURRENT_RENDERS", 6);

let activeRenders = 0;
const waiters: Array<() => void> = [];

/**
 * Führt `fn` unter der globalen Render-Semaphore aus (FIFO-Warteschlange).
 * `onAcquired` liefert die Wartezeit in ms — der Caller kann daraus ein
 * pipeline_event machen, damit User sehen, dass gewartet (nicht gehangen)
 * wird.
 */
export async function withRenderSlot<T>(
  fn: () => Promise<T>,
  onAcquired?: (waitedMs: number) => void,
): Promise<T> {
  const waitStart = Date.now();
  while (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeRenders += 1;
  onAcquired?.(Date.now() - waitStart);
  try {
    return await fn();
  } finally {
    activeRenders -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

/** Aktuelle Auslastung — für Logs/Diagnose. */
export function renderSlotStats(): {
  active: number;
  waiting: number;
  max: number;
} {
  return {
    active: activeRenders,
    waiting: waiters.length,
    max: MAX_CONCURRENT_RENDERS,
  };
}
