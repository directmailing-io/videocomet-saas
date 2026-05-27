/**
 * Internal fetch wrapper for Bunny.net APIs.
 *
 * - Exponential backoff (1s, 2s, 4s) on 5xx or network errors.
 * - Max 3 retries by default.
 * - Logs every request as `[bunny] METHOD URL -> STATUS in Xms`.
 * - Throws a structured BunnyApiError (status + body) on 4xx (no retry).
 */

export class BunnyApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;
  readonly method: string;

  constructor(opts: {
    status: number;
    body: string;
    url: string;
    method: string;
  }) {
    super(
      `[bunny] ${opts.method} ${opts.url} failed with ${opts.status}: ${opts.body}`,
    );
    this.name = "BunnyApiError";
    this.status = opts.status;
    this.body = opts.body;
    this.url = opts.url;
    this.method = opts.method;
  }
}

export interface BunnyFetchOptions {
  retries?: number;
}

const BACKOFF_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bunnyFetch(
  url: string,
  init: RequestInit = {},
  opts: BunnyFetchOptions = {},
): Promise<Response> {
  const maxRetries = opts.retries ?? 3;
  const method = (init.method ?? "GET").toUpperCase();

  let attempt = 0;
  // attempts: 0..maxRetries (inclusive) -> total maxRetries+1 tries
  // but spec says "max 3 retries", so we do 1 initial + up to 3 retries
  // We'll loop while attempt <= maxRetries
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startedAt = Date.now();
    let response: Response | undefined;
    let networkError: unknown;

    try {
      response = await fetch(url, init);
    } catch (err) {
      networkError = err;
    }

    const elapsedMs = Date.now() - startedAt;

    if (response) {
      // eslint-disable-next-line no-console
      console.log(
        `[bunny] ${method} ${url} -> ${response.status} in ${elapsedMs}ms`,
      );

      if (response.status >= 200 && response.status < 400) {
        return response;
      }

      if (response.status >= 400 && response.status < 500) {
        // No retry on 4xx
        const body = await response.text().catch(() => "");
        throw new BunnyApiError({
          status: response.status,
          body,
          url,
          method,
        });
      }

      // 5xx -> retry path
      if (attempt >= maxRetries) {
        const body = await response.text().catch(() => "");
        throw new BunnyApiError({
          status: response.status,
          body,
          url,
          method,
        });
      }
    } else {
      // Network error
      // eslint-disable-next-line no-console
      console.log(
        `[bunny] ${method} ${url} -> NETWORK_ERROR in ${elapsedMs}ms`,
      );

      if (attempt >= maxRetries) {
        throw new Error(
          `[bunny] ${method} ${url} failed after ${attempt + 1} attempts: ${String(
            networkError,
          )}`,
        );
      }
    }

    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    await sleep(delay);
    attempt += 1;
  }
}
