/**
 * Internal fetch wrapper for CRM provider APIs.
 *
 * - 15s default timeout via AbortController (overridable per call).
 * - Parses `Retry-After` (seconds or HTTP-date) and exposes it on the
 *   thrown `CrmHttpError` for the Phase-2 worker's backoff logic.
 * - Logs every request as `[crm:<provider>] METHOD URL -> STATUS in Xms`.
 *   Authorization / x-api-key headers are stripped from the log.
 * - Throws `CrmHttpError` on any 4xx/5xx response (no retries here —
 *   retries live in the worker, where the larger context decides).
 *
 * Pattern mirrors `src/lib/bunny/_fetch.ts`.
 */

import type { CrmProviderId } from "./types";
import { CrmHttpError } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "proxy-authorization",
]);

export interface CrmFetchInit extends RequestInit {
  /** Defaults to 15_000 ms. */
  timeoutMs?: number;
}

/**
 * Parst den `Retry-After`-Header. Format laut RFC kann eine ganzzahlige
 * Anzahl Sekunden ODER ein HTTP-Date sein. Liefert Millisekunden — oder
 * `undefined`, wenn der Header fehlt/ungültig ist.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  // Integer seconds
  if (/^\d+$/.test(trimmed)) {
    const sec = Number.parseInt(trimmed, 10);
    if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
    return undefined;
  }
  // HTTP-Date
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  const delta = parsed - Date.now();
  return delta > 0 ? delta : 0;
}

/**
 * Versucht den Body als JSON zu parsen; fällt auf Text zurück. Wird vom
 * Caller in den `CrmHttpError.body` gesteckt — strukturiert wenn möglich,
 * roh wenn nicht.
 */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isPlainHeaderObject(
  h: HeadersInit | undefined,
): h is Record<string, string> {
  return (
    !!h &&
    typeof h === "object" &&
    !Array.isArray(h) &&
    !(typeof Headers !== "undefined" && h instanceof Headers)
  );
}

/**
 * Reine Debug-Hilfe: Header-Liste OHNE sensitive Werte für das Log.
 * Wird nur aufgerufen, wenn debug-Logs aktiv sind (aktuell nur das
 * implizite Status-Log) — heißt: Wir bauen keinen großen String, wenn
 * niemand mitliest.
 */
export function redactHeadersForLog(
  h: HeadersInit | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    h.forEach((value, key) => {
      out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) {
      out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[redacted]" : v;
    }
    return out;
  }
  if (isPlainHeaderObject(h)) {
    for (const [k, v] of Object.entries(h)) {
      out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[redacted]" : v;
    }
  }
  return out;
}

export async function crmFetch(
  provider: CrmProviderId,
  url: string,
  init: CrmFetchInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose abort signals (caller may have passed one).
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const aborted =
      (err instanceof Error && err.name === "AbortError") ||
      controller.signal.aborted;
    // eslint-disable-next-line no-console
    console.log(
      `[crm:${provider}] ${method} ${url} -> ${
        aborted ? "TIMEOUT" : "NETWORK_ERROR"
      } in ${elapsedMs}ms`,
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[crm:${provider}] ${method} ${url} -> ${response.status} in ${elapsedMs}ms`,
  );

  if (response.status >= 200 && response.status < 400) {
    return response;
  }

  const body = await readBody(response);
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  throw new CrmHttpError({
    status: response.status,
    body,
    retryAfterMs,
    message: `[crm:${provider}] ${method} ${url} failed with ${response.status}`,
  });
}
