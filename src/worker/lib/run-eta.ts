/**
 * Auslastungsbewusste Run-ETA (W3, Skalierungs-Paket).
 *
 * Ein Worker-Loop (alle ~12 s, siehe index.ts) berechnet für jeden Run in
 * status='generating' eine ehrliche Restzeit und cached sie in Redis
 * (`eta:run:<runId>`, TTL 120 s). Die App liest den Cache nur (stream-Route,
 * Runs-Liste, Dashboard) — keine teuren Queries im Request-Pfad.
 *
 * Modell (aus dem Pitch, Plan V4):
 *  - Lernend statt geraten: Median der letzten echten Lead-Durchlaufzeiten,
 *    bevorzugt aus dem laufenden Run selbst (Events `stage='run'`,
 *    "completed in Xs"). Fingerprint-Reuse-Runs (~18 s/Lead) kalibrieren
 *    sich so von selbst, ohne Voll-Render-Schätzungen zu verfälschen.
 *  - Auslastung fließt ein: die Encode-Slots (MAX_CONCURRENT_ENCODES) und
 *    sync.so-Slots gelten prozess- bzw. accountweit. Laufen mehrere Runs,
 *    bekommt jeder rechnerisch nur seinen Anteil (Fairness via
 *    Job-Priorität = Zeilenposition, siehe queue-fairness).
 *  - Zwei Bahnen getrennt: Begrüßungs-Bahn (sync.so) und Render-Bahn werden
 *    einzeln geschätzt; die langsamere bestimmt die Anzeige.
 *  - Ruhige Anzeige: neue Schätzung wird mit dem heruntergezählten alten
 *    Wert geglättet (60/40), Ausgabe als Spanne [low, high].
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, pipelineEvents, runs } from "@/lib/db/schema";
import type { RunEtaEntry } from "@/lib/run-eta-format";
import { getRedisConnection } from "../queue";

export const RUN_ETA_KEY_PREFIX = "eta:run:";
const GLOBAL_MEDIAN_KEY = "eta:global:render-median-ms";
const INTRO_DURATIONS_KEY = "eta:intro:durations-ms";
const ENTRY_TTL_SEC = 120;
const GLOBAL_MEDIAN_TTL_SEC = 600;

/** Konservative Defaults, solange noch keine echten Messwerte da sind. */
const DEFAULT_RENDER_MS = 130_000;
const DEFAULT_INTRO_MS = 120_000;

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Wird vom intro-generation-Prozessor bei jedem erfolgreichen Staging
 * aufgerufen: hält die letzten 50 Intro-Dauern als Rolling-Window in Redis.
 */
export async function recordIntroDuration(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const redis = getRedisConnection();
  await redis
    .multi()
    .lpush(INTRO_DURATIONS_KEY, String(Math.round(ms)))
    .ltrim(INTRO_DURATIONS_KEY, 0, 49)
    .expire(INTRO_DURATIONS_KEY, 7 * 24 * 3600)
    .exec();
}

async function introMedianMs(): Promise<number> {
  try {
    const raw = await getRedisConnection().lrange(INTRO_DURATIONS_KEY, 0, 49);
    const med = median(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0));
    return med ?? DEFAULT_INTRO_MS;
  } catch {
    return DEFAULT_INTRO_MS;
  }
}

/** Median der Lead-Gesamtdauern eines Runs (letzte 30 fertige Leads). */
async function runRenderMedianMs(runId: string): Promise<number | null> {
  const rows = await db
    .select({ durationMs: pipelineEvents.durationMs })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.runId, runId),
        eq(pipelineEvents.stage, "run"),
        eq(pipelineEvents.level, "info"),
        sql`${pipelineEvents.leadId} IS NOT NULL`,
        sql`${pipelineEvents.durationMs} IS NOT NULL`,
        sql`${pipelineEvents.message} LIKE '%: completed in %'`,
      ),
    )
    .orderBy(sql`${pipelineEvents.ts} DESC`)
    .limit(30);
  return median(
    rows.map((r) => Number(r.durationMs)).filter((n) => Number.isFinite(n) && n > 0),
  );
}

/**
 * Globaler Fallback-Median (7 Tage, alle Runs) — nur wenn der laufende Run
 * selbst noch keine fertigen Leads hat. 10 min in Redis gecached, damit die
 * Query nicht bei jedem Tick läuft.
 */
async function globalRenderMedianMs(): Promise<number> {
  const redis = getRedisConnection();
  try {
    const cached = Number(await redis.get(GLOBAL_MEDIAN_KEY));
    if (Number.isFinite(cached) && cached > 0) return cached;
  } catch {
    // Redis-Hiccup: einfach frisch rechnen.
  }
  const rows = await db
    .select({ durationMs: pipelineEvents.durationMs })
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.stage, "run"),
        eq(pipelineEvents.level, "info"),
        sql`${pipelineEvents.leadId} IS NOT NULL`,
        sql`${pipelineEvents.durationMs} IS NOT NULL`,
        sql`${pipelineEvents.ts} > now() - interval '7 days'`,
        sql`${pipelineEvents.message} LIKE '%: completed in %'`,
      ),
    )
    .orderBy(sql`${pipelineEvents.ts} DESC`)
    .limit(300);
  const med =
    median(
      rows.map((r) => Number(r.durationMs)).filter((n) => Number.isFinite(n) && n > 0),
    ) ?? DEFAULT_RENDER_MS;
  try {
    await redis.set(GLOBAL_MEDIAN_KEY, String(med), "EX", GLOBAL_MEDIAN_TTL_SEC);
  } catch {
    // best effort
  }
  return med;
}

/**
 * Berechnet die ETA für alle Runs in status='generating' und schreibt sie
 * nach Redis. Fehler werden geloggt, nie geworfen — die ETA ist Komfort,
 * kein Pipeline-Bestandteil.
 */
export async function computeAndCacheRunEtas(): Promise<void> {
  const activeRuns = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, "generating"));
  if (activeRuns.length === 0) return;
  const runIds = activeRuns.map((r) => r.id);

  const counts = await db
    .select({
      runId: leads.runId,
      renderRemaining: sql<number>`COUNT(*) FILTER (WHERE ${leads.status} NOT IN ('completed','failed'))::int`,
      introRemaining: sql<number>`COUNT(*) FILTER (WHERE ${leads.introStatus} IN ('queued','generating'))::int`,
    })
    .from(leads)
    .where(and(inArray(leads.runId, runIds), isNull(leads.removedAt)))
    .groupBy(leads.runId);
  const byRun = new Map(counts.map((c) => [c.runId, c]));

  const renderSlots = envInt("MAX_CONCURRENT_ENCODES", 4);
  const introSlots = envInt(
    "INTRO_GENERATION_WORKER_CONCURRENCY",
    envInt("SYNCSO_CONCURRENCY", 3),
  );
  const renderActive = counts.filter((c) => c.renderRemaining > 0).length || 1;
  const introActive = counts.filter((c) => c.introRemaining > 0).length || 1;

  const dIntro = await introMedianMs();
  const redis = getRedisConnection();
  const now = Date.now();

  for (const runId of runIds) {
    try {
      const c = byRun.get(runId);
      const renderRemaining = c?.renderRemaining ?? 0;
      const introRemaining = c?.introRemaining ?? 0;
      if (renderRemaining === 0 && introRemaining === 0) continue;

      const dRender =
        (await runRenderMedianMs(runId)) ?? (await globalRenderMedianMs());

      const shareR = renderSlots / renderActive;
      const laneRenderMs =
        renderRemaining > 0
          ? Math.max(dRender, (renderRemaining * dRender) / shareR)
          : 0;
      const shareI = introSlots / introActive;
      const laneIntroMs =
        introRemaining > 0
          ? Math.max(dIntro, (introRemaining * dIntro) / shareI)
          : 0;
      // Intro muss pro Lead VOR dem Render fertig sein — nach dem letzten
      // Intro folgt mindestens noch ein Render-Durchlauf.
      const rawMs =
        introRemaining > 0
          ? Math.max(laneRenderMs, laneIntroMs + dRender)
          : laneRenderMs;

      // Glättung: alten Wert herunterzählen und mit der frischen Schätzung
      // mischen — die Anzeige springt so nicht nervös hin und her.
      let smoothedMs = rawMs;
      try {
        const prevRaw = await redis.get(`${RUN_ETA_KEY_PREFIX}${runId}`);
        if (prevRaw) {
          const prev = JSON.parse(prevRaw) as RunEtaEntry;
          const elapsed = now - Date.parse(prev.updatedAt);
          const countdown = prev.remainingMs - elapsed;
          if (Number.isFinite(countdown) && countdown > 0) {
            smoothedMs = Math.round(0.6 * countdown + 0.4 * rawMs);
          }
        }
      } catch {
        // kein alter Wert — frische Schätzung nehmen
      }

      const entry: RunEtaEntry = {
        remainingMs: Math.round(smoothedMs),
        lowMs: Math.max(45_000, Math.round(smoothedMs * 0.75)),
        highMs: Math.round(smoothedMs * 1.35) + 90_000,
        updatedAt: new Date(now).toISOString(),
        renderRemaining,
        introRemaining,
      };
      await redis.set(
        `${RUN_ETA_KEY_PREFIX}${runId}`,
        JSON.stringify(entry),
        "EX",
        ENTRY_TTL_SEC,
      );
    } catch (err) {
      console.warn(
        `[run-eta] failed for run=${runId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
