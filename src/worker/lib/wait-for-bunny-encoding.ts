/**
 * Wait-for-Bunny-Encoding helper.
 *
 * Hintergrund (Bug E1, Race):
 *
 *   Direkt nach `uploadVideo()` ist Bunny noch im async-Encoding. Ein sofortiges
 *   `getVideo(guid).availableResolutions` liefert dann einen leeren String, und
 *   `getVideoDownloadUrls()` produziert nur den `original`-Fallback (wenn
 *   `hasOriginal=true`) — oder ein leeres Array. Das wird als `videoMp4Url=null`
 *   am Lead persistiert, und der Custom-LP-Player faellt auf die hardcoded
 *   `play_720p.mp4` zurück → 404 für Portrait/kleine Videos.
 *
 *   Workaround vor diesem Helper: ein einzelner best-effort getVideo()-Call
 *   direkt nach Upload. Wenn Bunny zu dem Zeitpunkt noch nicht durch war, blieb
 *   mp4Url null und der Public-Renderer musste lazy reparieren.
 *
 *   Stattdessen pollen wir jetzt SYNCHRON im Worker (bounded), bis Bunny einen
 *   nutzbaren State erreicht hat. Wenn 60 s nicht reichen, werfen wir einen
 *   `BunnyEncodingRetryableError` — BullMQ retried den Job mit Backoff, der
 *   Lead bleibt in `uploading`-Status (für video-upload) bzw. der shared-run-
 *   State bleibt auf `uploading` (Polling-Worker warten weiter).
 *
 * Bunny `status` Field semantics:
 *   0=created, 1=uploaded, 2=processing, 3=transcoding, 4=finished, 5=error.
 *
 * "Ready genug" für unsere Zwecke heisst:
 *   - status >= 3 (transcoding hat begonnen und produziert MP4-Renditions), ODER
 *   - availableResolutions non-empty (mind. eine MP4-Variante online).
 *
 * Wichtig: dieser Helper ist BOUNDED. Maximal `POLL_TIMEOUT_MS` (default 60s).
 * Es kann NIE unendlich laufen — der Caller bekommt entweder ein Result oder
 * einen Throw.
 */

import { getVideo } from "@/lib/bunny/stream";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Wird vom Worker geworfen wenn Bunnys Encoding nach Timeout immer noch nicht
 * weit genug ist. BullMQ-konvention: ein normaler Error triggert Retry mit
 * Backoff. Wir markieren das hier explizit mit `name='RetryableError'` damit
 * Observability (Sentry, Logs) den Retry-Pfad sauber unterscheiden kann von
 * "echten" Fehlern (z.B. BunnyApiError).
 */
export class BunnyEncodingRetryableError extends Error {
  override name = "RetryableError" as const;
  readonly retryable = true as const;
  constructor(message: string) {
    super(message);
  }
}

export interface BunnyVideoReadyMeta {
  /** Raw meta wie von Bunny zurückgegeben — Caller darf weiter rein-greifen. */
  meta: Record<string, unknown>;
  /** Bunny status field (0..5). */
  status: number;
  /** "720p,480p,…" oder "" wenn nicht parsbar. */
  availableResolutions: string;
  /** width aus meta (oder 0). */
  width: number;
  /** height aus meta (oder 0). */
  height: number;
  /** wie viele Polls wir gebraucht haben (0 = sofort ready). Für Logs. */
  attempts: number;
  /** ms verbraucht. Für Logs. */
  elapsedMs: number;
}

export interface WaitForBunnyEncodingOptions {
  /** override default 5s. Test-Knopf. */
  intervalMs?: number;
  /** override default 60s. Test-Knopf. */
  timeoutMs?: number;
  /**
   * Optionaler Injection-Punkt für `getVideo` — erlaubt einfaches Mocking
   * im Unit-Test ohne MSW. In Production: undefined → echter Bunny-Call.
   */
  getVideoFn?: (videoId: string) => Promise<Record<string, unknown>>;
  /** Optionaler Sleep-Injection-Punkt (für fake-timers im Test). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Optionaler Now-Provider (für deterministische Timeouts im Test). */
  nowFn?: () => number;
}

function parseStatus(meta: Record<string, unknown>): number {
  const raw = meta.status;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseResolutions(meta: Record<string, unknown>): string {
  const v = meta.availableResolutions;
  return typeof v === "string" ? v.trim() : "";
}

function parseDim(meta: Record<string, unknown>, key: "width" | "height"): number {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pollt `getVideo(videoId)` bis Bunnys Encoding "ready genug" ist (siehe oben),
 * oder bis Timeout. Throws `BunnyEncodingRetryableError` bei Timeout.
 *
 * Bei `status===5` (Bunny-side encoding-error) throwen wir SOFORT einen
 * `Error` (kein Retry — Bunny hat die Quelle verworfen, weitere Polls bringen
 * nichts).
 */
export async function waitForBunnyEncoding(
  videoId: string,
  options: WaitForBunnyEncodingOptions = {},
): Promise<BunnyVideoReadyMeta> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const getVideoFn = options.getVideoFn ?? getVideo;
  const sleepFn =
    options.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = options.nowFn ?? (() => Date.now());

  const startedAt = nowFn();
  let attempts = 0;
  let lastMeta: Record<string, unknown> | null = null;

  // Hart-Cap: maximale Anzahl Iterationen = ceil(timeout / interval) + 1.
  // Defensiv, falls die Zeit-Quelle (mock) komisch springt — die Schleife
  // KANN NIE unendlich laufen.
  const maxIterations = Math.ceil(timeoutMs / Math.max(1, intervalMs)) + 1;

  for (let i = 0; i < maxIterations; i++) {
    attempts = i + 1;
    let meta: Record<string, unknown>;
    try {
      meta = await getVideoFn(videoId);
    } catch (err) {
      // Transienter Netzwerkfehler — wir tolerieren ihn solange Timeout nicht
      // erreicht. Wenn Timeout HEAVY-debounced ist, fliegen wir unten raus.
      console.warn(
        `[wait-for-bunny] getVideo(${videoId}) attempt ${attempts} failed: ${(err as Error).message}`,
      );
      const elapsed = nowFn() - startedAt;
      if (elapsed >= timeoutMs) break;
      await sleepFn(intervalMs);
      continue;
    }
    lastMeta = meta;
    const status = parseStatus(meta);
    const availableResolutions = parseResolutions(meta);
    const width = parseDim(meta, "width");
    const height = parseDim(meta, "height");

    if (status === 5) {
      // Encode-Error von Bunny. Kein Retry — Quelle ist defekt.
      throw new Error(
        `[wait-for-bunny] Bunny reported encoding error (status=5) for ${videoId}`,
      );
    }

    if (status >= 3 || availableResolutions.length > 0) {
      return {
        meta,
        status,
        availableResolutions,
        width,
        height,
        attempts,
        elapsedMs: nowFn() - startedAt,
      };
    }

    const elapsed = nowFn() - startedAt;
    if (elapsed + intervalMs >= timeoutMs) break;
    await sleepFn(intervalMs);
  }

  const elapsedMs = nowFn() - startedAt;
  const lastStatus = lastMeta ? parseStatus(lastMeta) : -1;
  throw new BunnyEncodingRetryableError(
    `[wait-for-bunny] timeout after ${elapsedMs}ms / ${attempts} attempts (videoId=${videoId}, lastStatus=${lastStatus}) — retrying job`,
  );
}
