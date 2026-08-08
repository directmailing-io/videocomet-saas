/**
 * Lasttest W4: Anrede-Dedup-Claim-Protokoll unter echter Parallelität.
 *
 * Spielt einen Groß-Run (Default 1.000 Leads, 600 einzigartige Anreden)
 * gegen ECHTES Redis (BullMQ inkl. moveToDelayed/DelayedError) und ECHTES
 * Postgres (die realen claim/mark/release-Queries aus intro-dedup.ts)
 * durch. Nur die Generierung selbst (TTS + sync.so + Bunny) ist durch
 * einen Sleep ersetzt; Dauern sind per --scale gestaucht (60 → 108 s
 * Generierung werden 1,8 s, 30-s-Warte-Tick wird 0,5 s).
 *
 * Kern-Invariante: Jede einzigartige Anrede wird EXAKT EINMAL generiert —
 * egal wie viele Jobs gleichzeitig um denselben Schlüssel konkurrieren.
 *
 * Räumt hinter sich auf (eigener Test-User, eigene Queue, Cache-Rows).
 *
 * Usage:
 *   npx tsx scripts/load-test-intro-dedup.ts                # 1000/600, scale 60
 *   npx tsx scripts/load-test-intro-dedup.ts --leads 200 --unique 120 --scale 120
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { randomUUID } from "node:crypto";
import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  claimIntroCache,
  markIntroCacheReady,
  releaseIntroCacheClaim,
} from "../src/worker/lib/intro-dedup";

function arg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  const parsed = idx >= 0 ? Number(process.argv[idx + 1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LEADS = arg("leads", 1000);
const UNIQUE = Math.min(arg("unique", 600), LEADS);
const SCALE = arg("scale", 60);
const CONCURRENCY = arg("concurrency", 3);

// Reale Richtwerte (Prod-Messungen): ~108 s pro Generierung → ~100/h bei
// 3 Slots; Warte-Tick der Dedup-Wartenden 30 s (intro-generation.ts).
const GEN_MS_REAL = 108_000;
const WAIT_TICK_MS_REAL = 30_000;
const GEN_MS = Math.max(50, Math.round(GEN_MS_REAL / SCALE));
const WAIT_TICK_MS = Math.max(50, Math.round(WAIT_TICK_MS_REAL / SCALE));

const QUEUE_NAME = "loadtest-intro-dedup";
const KEY_PREFIX = `loadtest-${Date.now()}-`;

// HEAD-Verifikation der Cache-Hits ins Leere laufen lassen — es gibt keine
// echten Bunny-Assets in der Simulation.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
  if (init?.method === "HEAD") return { ok: true } as Response;
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

const stats = {
  generated: 0,
  reused: 0,
  waitTicks: 0,
  claimMsMax: 0,
  claimMsSum: 0,
  claimCount: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL fehlt (.env.local/.env)");

  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || "6379"),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };

  // Eigener Test-User (FK für intro_cache), am Ende per CASCADE entsorgt.
  const [{ id: userId }] = (await db.execute(
    sql`INSERT INTO users (email, password_hash)
        VALUES (${`loadtest-${randomUUID()}@invalid.local`}, 'x')
        RETURNING id`,
  )) as unknown as Array<{ id: string }>;

  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.obliterate({ force: true }).catch(() => undefined);

  // Anrede-Verteilung: `UNIQUE` verschiedene Schlüssel, Rest Duplikate —
  // gemischt, damit Duplikate realistisch WÄHREND der Generierung eintreffen.
  const keys: string[] = [];
  for (let i = 0; i < LEADS; i++) {
    keys.push(`${KEY_PREFIX}${i < UNIQUE ? i : Math.floor(Math.random() * UNIQUE)}`);
  }
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  let completed = 0;
  const started = Date.now();

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ key: string }>, token?: string) => {
      const t0 = Date.now();
      const claim = await claimIntroCache(userId, job.data.key);
      const claimMs = Date.now() - t0;
      stats.claimMsMax = Math.max(stats.claimMsMax, claimMs);
      stats.claimMsSum += claimMs;
      stats.claimCount++;

      if (claim.role === "hit") {
        stats.reused++;
        return;
      }
      if (claim.role === "wait") {
        stats.waitTicks++;
        await job.moveToDelayed(Date.now() + WAIT_TICK_MS, token);
        throw new DelayedError();
      }
      try {
        await sleep(GEN_MS * (0.7 + Math.random() * 0.6));
        await markIntroCacheReady(userId, job.data.key, {
          url: `https://loadtest.invalid/${job.data.key}.mp4`,
          startTrimMs: 0,
          firstName: "Loadtest",
          generatedAt: new Date().toISOString(),
        });
        stats.generated++;
      } catch (err) {
        await releaseIntroCacheClaim(userId, job.data.key).catch(() => undefined);
        throw err;
      }
    },
    { connection, concurrency: CONCURRENCY },
  );
  worker.on("completed", () => {
    completed++;
    if (completed % 100 === 0 || completed === LEADS) {
      console.log(
        `  ${completed}/${LEADS} fertig (${((Date.now() - started) / 1000).toFixed(0)}s) — generiert ${stats.generated}, wiederverwendet ${stats.reused}, Warte-Ticks ${stats.waitTicks}`,
      );
    }
  });
  worker.on("failed", (job, err) => {
    console.error(`  FEHLER job=${job?.id}: ${err.message}`);
  });

  console.log(
    `Lasttest: ${LEADS} Leads, ${UNIQUE} einzigartige Anreden, Concurrency ${CONCURRENCY}, Scale 1:${SCALE} (Gen ${GEN_MS}ms, Warte-Tick ${WAIT_TICK_MS}ms)`,
  );
  await queue.addBulk(
    keys.map((key, i) => ({
      name: "lead",
      data: { key },
      opts: { jobId: `lt-${i}`, attempts: 1 },
    })),
  );

  // Deadline: theoretisches Serien-Minimum × 4 als großzügige Obergrenze.
  const deadlineMs = ((UNIQUE * GEN_MS) / CONCURRENCY) * 4 + 60_000;
  while (completed < LEADS) {
    if (Date.now() - started > deadlineMs) {
      throw new Error(`Deadline überschritten (${completed}/${LEADS} fertig)`);
    }
    await sleep(500);
  }

  const wallMs = Date.now() - started;
  const readyRows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM intro_cache
        WHERE user_id = ${userId} AND status = 'ready'`,
  )) as unknown as Array<{ n: number }>;

  console.log("\n── Ergebnis ─────────────────────────────────────────");
  console.log(`Wanduhr (Simulation): ${(wallMs / 1000).toFixed(1)}s`);
  console.log(
    `Hochgerechnet real (×${SCALE}): ~${((wallMs * SCALE) / 3_600_000).toFixed(2)}h für die Begrüßungs-Bahn`,
  );
  console.log(`Generiert: ${stats.generated} (Soll: ${UNIQUE})`);
  console.log(`Wiederverwendet: ${stats.reused} (Soll: ${LEADS - UNIQUE})`);
  console.log(`Warte-Ticks (delayed re-checks): ${stats.waitTicks}`);
  console.log(
    `Claim-Latenz: Ø ${(stats.claimMsSum / Math.max(1, stats.claimCount)).toFixed(1)}ms, max ${stats.claimMsMax}ms (${stats.claimCount} Claims)`,
  );
  console.log(`ready-Rows in intro_cache: ${readyRows[0]?.n}`);

  const ok =
    stats.generated === UNIQUE &&
    stats.reused === LEADS - UNIQUE &&
    readyRows[0]?.n === UNIQUE;
  console.log(
    ok
      ? "\n✓ INVARIANTE HÄLT: jede einzigartige Anrede exakt einmal generiert."
      : "\n✗ INVARIANTE VERLETZT — Zahlen oben prüfen!",
  );

  await worker.close();
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Lasttest fehlgeschlagen:", err);
  process.exit(1);
});
