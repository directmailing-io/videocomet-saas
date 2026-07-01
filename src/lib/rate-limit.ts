/**
 * Redis-basiertes Rate-Limiting fuer sensible Endpoints.
 *
 * Nutzt die existierende BullMQ-Redis-Verbindung fuer Sliding-Window-
 * Counter. Best-effort: bei Redis-Ausfall lassen wir requests durch
 * (fail-open) — sonst waere die App bei Redis-Downtime komplett
 * unbenutzbar. Fuer echte Security-kritische Rate-Limits (Login-Brute-
 * Force) waere fail-closed richtig; fuer Signup-Bot-Schutz ist fail-open
 * akzeptabel weil Turnstile parallel greift.
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
  const redis = getRedis();
  if (!redis) {
    // Fail-open bei Redis-Ausfall
    return { ok: true, count: 0, ttl: 0 };
  }
  const fullKey = `rl:${key}`;
  try {
    const pipeline = redis.multi();
    pipeline.incr(fullKey);
    pipeline.expire(fullKey, windowSec, "NX"); // TTL nur beim ersten Inkrement
    pipeline.ttl(fullKey);
    const results = await pipeline.exec();
    if (!results) return { ok: true, count: 0, ttl: 0 };
    const count = Number(results[0]?.[1] ?? 0);
    const ttl = Number(results[2]?.[1] ?? windowSec);
    return { ok: count <= max, count, ttl };
  } catch {
    return { ok: true, count: 0, ttl: 0 };
  }
}
