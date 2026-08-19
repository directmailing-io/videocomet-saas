/**
 * Schutzschicht um die Google-API-Aufrufe des Workers (Docs + Drive).
 *
 * Hintergrund (Incident 2026-07-15): Bei einem 500-Brief-Run liefen
 * ~110 `documents.batchUpdate`-Writes/Minute gegen die Docs-API — Googles
 * Standard-Quota ist 60 Writes/Minute PRO SERVICE-ACCOUNT. Die 429er
 * führten über den damaligen stillen HTML-Fallback zu ~40% optisch
 * defekten Briefen beim Kunden.
 *
 * Zwei Mechanismen:
 *  1. `acquireDocsWriteSlot()` — Sliding-Window-Limiter (Default 50/min,
 *     Marge unter 60), damit 429 gar nicht erst entsteht. Seit 2026-08-19
 *     (zweiter Render-Server) läuft das Fenster über Redis, damit ALLE
 *     Worker-Prozesse zusammen unter der Quota bleiben; fällt Redis aus,
 *     greift der alte In-Process-Limiter als Fallback.
 *  2. `withGoogleRetry()` — Retry mit exponentiellem Backoff + Jitter für
 *     transiente Fehler (429, 5xx, Netzwerk, quota-kodierte 403). Permanente
 *     Fehler (404 Template gelöscht, echte Permission-Fehler) werfen sofort.
 *
 * Nur `documents.batchUpdate` zählt auf die knappe Docs-Write-Quota.
 * Drive-Calls (copy/export/delete) haben ~12.000 Queries/min und brauchen
 * keinen Limiter — aber denselben Retry-Schutz.
 */

import { getRedisConnection } from "../queue";

const WINDOW_MS = 60_000;

function docsWriteLimitPerMin(): number {
  const raw = Number(process.env.DOCS_WRITE_LIMIT_PER_MIN ?? "50");
  return Number.isFinite(raw) && raw >= 1 ? raw : 50;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Redis-Sliding-Window (geteilt über alle Worker-Prozesse) ───────────────

const REDIS_WINDOW_KEY = "gapi:docs-write-window";
/**
 * Atomar: Fenster aufräumen, zählen, bei freiem Slot reservieren. Lua,
 * damit zwei Prozesse nicht zwischen ZCARD und ZADD denselben letzten
 * Slot doppelt nehmen.
 */
const ACQUIRE_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - ${WINDOW_MS})
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ${2 * WINDOW_MS})
  return 1
end
return 0
`;

let slotSeq = 0;

/** true = Slot reserviert, false = Fenster voll, null = Redis nicht nutzbar. */
async function tryAcquireDistributedSlot(
  limit: number,
): Promise<boolean | null> {
  try {
    const redis = getRedisConnection();
    const member = `${process.pid}-${Date.now()}-${slotSeq++}`;
    const res = await redis.eval(
      ACQUIRE_LUA,
      1,
      REDIS_WINDOW_KEY,
      String(Date.now()),
      String(limit),
      member,
    );
    return res === 1;
  } catch {
    return null;
  }
}

let writeStamps: number[] = [];
// Promise-Kette serialisiert die Slot-Vergabe → FIFO-Fairness zwischen
// den parallelen Pipeline-Jobs EINES Prozesses.
let acquireTail: Promise<void> = Promise.resolve();

/**
 * Wartet, bis im 60s-Fenster wieder ein Docs-Write-Slot frei ist, und
 * reserviert ihn. Muss vor JEDEM `documents.batchUpdate`-Versuch
 * aufgerufen werden (auch vor Retries — jeder Versuch ist ein Write).
 */
export function acquireDocsWriteSlot(): Promise<void> {
  const run = async () => {
    const limit = docsWriteLimitPerMin();
    for (;;) {
      const acquired = await tryAcquireDistributedSlot(limit);
      if (acquired === true) return;
      if (acquired === false) {
        // Fenster global voll — kurz warten, Jitter gegen Gleichtakt
        // der Worker-Prozesse.
        await sleep(1_000 + Math.random() * 500);
        continue;
      }
      // Redis nicht erreichbar → alter In-Process-Limiter als Fallback.
      const now = Date.now();
      writeStamps = writeStamps.filter((t) => now - t < WINDOW_MS);
      if (writeStamps.length < limit) {
        writeStamps.push(now);
        return;
      }
      await sleep(writeStamps[0] + WINDOW_MS - now + 50);
    }
  };
  const p = acquireTail.then(run);
  acquireTail = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

/** Transienter Google-Fehler, der auch nach allen Retries bestehen blieb. */
export class GoogleTransientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GoogleTransientError";
    this.cause = cause;
  }
}

interface GoogleErrShape {
  code?: unknown;
  message?: unknown;
  response?: { status?: number; headers?: unknown };
  errors?: Array<{ reason?: string }>;
}

function isTransient(err: unknown): boolean {
  const e = err as GoogleErrShape;
  const status =
    typeof e?.code === "number" ? e.code : e?.response?.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  // Google kodiert Quota-/Rate-Fehler teils als 403 mit speziellem reason.
  const reason = String(e?.errors?.[0]?.reason ?? "");
  if (
    status === 403 &&
    /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded/i.test(
      reason,
    )
  ) {
    return true;
  }
  const msg = String(e?.message ?? "");
  if (/quota exceeded|rate limit/i.test(msg)) return true;
  // Netzwerk-Fehler (gaxios setzt code als String).
  if (
    typeof e?.code === "string" &&
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE|ENOTFOUND/.test(e.code)
  ) {
    return true;
  }
  if (/socket hang up|fetch failed|network/i.test(msg)) return true;
  return false;
}

function retryAfterMs(err: unknown): number | null {
  const headers = (err as GoogleErrShape)?.response?.headers as
    | { get?: (k: string) => string | null }
    | Record<string, string>
    | undefined;
  if (!headers) return null;
  const raw =
    typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (k: string) => string | null }).get("retry-after")
      : (headers as Record<string, string>)["retry-after"];
  const secs = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 45_000;

/**
 * Führt einen Google-API-Call aus und wiederholt ihn bei transienten
 * Fehlern (429/5xx/Netzwerk) mit exponentiellem Backoff + Jitter.
 * `Retry-After`-Header wird respektiert. Permanente Fehler (404, echte
 * 403) werden unverändert durchgereicht — die muss der Aufrufer als
 * Konfigurationsproblem behandeln, Retry hilft dort nicht.
 */
export async function withGoogleRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      // Voll-Jitter auf der oberen Hälfte: [exp/2, exp]
      let delay = exp / 2 + Math.random() * (exp / 2);
      const ra = retryAfterMs(err);
      if (ra !== null) delay = Math.max(delay, ra);
      console.warn(
        `[google-api-guard] ${label}: transient error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay / 1000)}s: ${(err as Error)?.message}`,
      );
      await sleep(delay);
    }
  }
  throw new GoogleTransientError(
    `${label}: nach ${MAX_ATTEMPTS} Versuchen weiterhin transienter Google-Fehler (${(lastErr as Error)?.message})`,
    lastErr,
  );
}
