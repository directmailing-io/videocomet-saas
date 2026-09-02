/**
 * Redis-basiertes Rate-Limiting fuer sensible Endpoints.
 *
 * Nutzt die existierende BullMQ-Redis-Verbindung fuer Sliding-Window-
 * Counter. Bei Redis-Ausfall faellt die Pruefung auf einen prozesslokalen
 * In-Memory-Zaehler zurueck (seit 2026-09-02). Vorher war das Verhalten
 * "fail-open": ohne Redis gab es GAR KEIN Limit, also auch keine Brute-
 * Force-Bremse am Login. Der In-Memory-Fallback ist pro Container-Prozess
 * und damit weicher als Redis (mehrere Instanzen zaehlen getrennt), aber
 * er haelt Login/Reset/Signup auch im Notfall gebremst, ohne die App
 * unbenutzbar zu machen.
 */

import IORedis from "ioredis";

let cachedClient: IORedis | null = null;

function getRedis(): IORedis | null {
  if (cachedClient) return cachedClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    cachedClient = new IORedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    cachedClient.on("error", (err) => {
      console.warn("[rate-limit] redis error:", err.message);
    });
    return cachedClient;
  } catch {
    return null;
  }
}

// ── In-Memory-Fallback ────────────────────────────────────────────────────

interface MemoryBucket {
  count: number;
  /** Unix-ms, ab wann der Bucket verfaellt. */
  expiresAt: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();
const MEMORY_MAX_KEYS = 50_000;
let lastSweep = 0;

function sweepMemory(now: number): void {
  // Hoechstens alle 30 s aufraeumen, sonst bei jedem Call O(n).
  if (now - lastSweep < 30_000 && memoryBuckets.size < MEMORY_MAX_KEYS) return;
  lastSweep = now;
  memoryBuckets.forEach((b, k) => {
    if (b.expiresAt <= now) memoryBuckets.delete(k);
  });
  // Notbremse gegen Speicherwachstum durch Key-Flut: aelteste Eintraege
  // verwerfen (Map iteriert in Einfuege-Reihenfolge).
  while (memoryBuckets.size > MEMORY_MAX_KEYS) {
    const first = memoryBuckets.keys().next().value;
    if (first === undefined) break;
    memoryBuckets.delete(first);
  }
}

function checkMemory(
  fullKey: string,
  max: number,
  windowSec: number,
): { ok: boolean; count: number; ttl: number } {
  const now = Date.now();
  sweepMemory(now);
  let bucket = memoryBuckets.get(fullKey);
  if (!bucket || bucket.expiresAt <= now) {
    bucket = { count: 0, expiresAt: now + windowSec * 1000 };
    memoryBuckets.set(fullKey, bucket);
  }
  bucket.count += 1;
  const ttl = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
  return { ok: bucket.count <= max, count: bucket.count, ttl };
}

/**
 * Prueft ob `key` in den letzten `windowSec` Sekunden hoechstens `max`
 * Mal getriggert wurde. Erhoeht den Counter atomar. Rueckgabe:
 *   - ok: true → request darf durch
 *   - ok: false → Rate-Limit hit
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<{ ok: boolean; count: number; ttl: number }> {
  const fullKey = `rl:${key}`;
  const redis = getRedis();
  if (!redis) {
    return checkMemory(fullKey, max, windowSec);
  }
  try {
    const pipeline = redis.multi();
    pipeline.incr(fullKey);
    pipeline.expire(fullKey, windowSec, "NX"); // TTL nur beim ersten Inkrement
    pipeline.ttl(fullKey);
    const results = await pipeline.exec();
    if (!results) return checkMemory(fullKey, max, windowSec);
    const count = Number(results[0]?.[1] ?? 0);
    const ttl = Number(results[2]?.[1] ?? windowSec);
    return { ok: count <= max, count, ttl };
  } catch {
    return checkMemory(fullKey, max, windowSec);
  }
}
