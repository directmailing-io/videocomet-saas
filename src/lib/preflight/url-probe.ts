/**
 * Lightweight URL reachability probe — Phase 1 of the Lead Preflight.
 *
 * Goal: in ≤ 8 seconds, classify a Lead's website URL into one of
 *   ok | url_dead | url_redirect_parking | tls_error | slow | bot_block |
 *   dns_error
 * so the downstream screenshot stage only runs against URLs that actually
 * have a chance of producing a usable image — and so the operator sees the
 * specific failure class in the review grid.
 *
 * Pipeline:
 *   1. Normalise the raw URL (allow bare `example.com` style).
 *   2. DNS A-lookup with a 3 s timeout (catches typos + dead domains BEFORE
 *      we pay for a TCP handshake).
 *   3. HEAD request with a 5 s timeout, follow up to 5 redirects.
 *      → 405 / 501 → fall back to GET with `Range: bytes=0-2048`.
 *   4. Inspect headers/status for Cloudflare / Datadome / ddos-guard bot
 *      walls.
 *   5. Inspect the FINAL URL host against the parking blacklist.
 *   6. Promote any total > 8 s to `slow` (URL is reachable but the resulting
 *      video would have its own scroll-capture timing badly off).
 *
 * Out of scope here: visual heuristics (blank / cookie-wall) — those happen
 * later in the screenshot stage.
 */

import dns from "node:dns";

const DNS_TIMEOUT_MS = 3_000;
const HTTP_TIMEOUT_MS = 5_000;
const SLOW_THRESHOLD_MS = 8_000;
const MAX_REDIRECTS = 5;

/** Result-Type returned by `probeUrl`. */
export interface UrlProbeResult {
  ok: boolean;
  status:
    | "ok"
    | "url_dead"
    | "url_redirect_parking"
    | "tls_error"
    | "slow"
    | "bot_block"
    | "dns_error";
  httpStatus: number | null;
  finalUrl: string | null;
  durationMs: number;
  errorMessage: string | null;
}

/** Classifies a Node-error code string against known TLS failure patterns. */
function isTlsErrorCode(code: string | undefined): boolean {
  if (!code) return false;
  return (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code.startsWith("ERR_SSL_")
  );
}

/** Tries hard to extract a Node `code` property from any thrown value. */
function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const maybe = err as { code?: unknown; cause?: unknown };
    if (typeof maybe.code === "string") return maybe.code;
    // `undici`/`fetch` wraps low-level errors in `error.cause`.
    if (maybe.cause && typeof maybe.cause === "object") {
      const causeCode = (maybe.cause as { code?: unknown }).code;
      if (typeof causeCode === "string") return causeCode;
    }
  }
  return undefined;
}

/**
 * Normalises a user-supplied URL string:
 *   - trims whitespace
 *   - prepends `https://` when no scheme is present (so DNS lookup works)
 *   - tolerates trailing junk (`URL` constructor still parses).
 * Returns `null` when the string is unsalvageable.
 */
function normaliseUrl(raw: string): URL | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/**
 * Wraps `dns.promises.resolve4` in a timeout. We do NOT consider a DNS6-only
 * domain as "alive" here — the small minority of IPv6-only sites is not
 * worth the extra round trip in the hot path.
 */
async function resolveWithTimeout(
  host: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // We race the resolve against a timer + the caller's abort signal.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, reason: "dns_timeout" });
    }, DNS_TIMEOUT_MS);
    timer.unref();

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "aborted" });
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve({ ok: false, reason: "aborted" });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    dns.promises
      .resolve4(host)
      .then((addrs) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (addrs && addrs.length > 0) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, reason: "no_a_record" });
        }
      })
      .catch((err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, reason: err.code ?? "dns_error" });
      });
  });
}

/**
 * Detects whether a response looks like an anti-bot challenge.
 *
 * We rely on header hints (Cloudflare, Datadome, DDoS-Guard) AND on the
 * status code combination 403/429 — the latter alone could also be a real
 * authorisation failure, but in the Lead-Preflight context that's still a
 * "we can't capture this site" outcome and gets the same bucket.
 */
function isBotBlock(status: number, headers: Headers): boolean {
  if (status !== 403 && status !== 429) return false;
  const server = (headers.get("server") || "").toLowerCase();
  const cfMitigated = headers.get("cf-mitigated");
  const ddos = (headers.get("server") || "").toLowerCase();
  if (server.includes("cloudflare")) return true;
  if (cfMitigated && cfMitigated.toLowerCase().includes("challenge")) return true;
  if (ddos.includes("ddos-guard")) return true;
  // Datadome sets X-Dd-* headers and sometimes a `set-cookie: datadome=`.
  const setCookie = headers.get("set-cookie") || "";
  if (setCookie.toLowerCase().includes("datadome=")) return true;
  return false;
}

/**
 * Issues a single HEAD (or GET-with-Range) request, manually following
 * redirects so we keep ALL final-URL information. `fetch` would silently
 * collapse the chain and we'd lose the parking-redirect detection.
 *
 * Returns either the terminal response + final URL, or an error reason.
 */
async function doHeadFollow(
  initialUrl: string,
  signal: AbortSignal | undefined,
  perRequestTimeoutMs: number,
): Promise<
  | {
      kind: "response";
      response: Response;
      finalUrl: string;
    }
  | {
      kind: "error";
      reason: "tls_error" | "dns_error" | "url_dead" | "aborted";
      message: string;
    }
> {
  let currentUrl = initialUrl;
  let method: "HEAD" | "GET" = "HEAD";
  let allowGetFallback = true;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const ac = new AbortController();
    const onAbort = (): void => ac.abort();
    if (signal) {
      if (signal.aborted) return { kind: "error", reason: "aborted", message: "aborted" };
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => ac.abort(), perRequestTimeoutMs);
    timer.unref();

    const init: RequestInit = {
      method,
      redirect: "manual",
      signal: ac.signal,
      headers: {
        // A realistic UA reduces the number of false-positive bot walls
        // we hit; an obvious bot UA gets us blocked even on benign sites.
        "User-Agent":
          "Mozilla/5.0 (compatible; VideoCometPreflight/1.0; +https://app.videocomet.de/bot)",
        Accept: "*/*",
        ...(method === "GET" ? { Range: "bytes=0-2048" } : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(currentUrl, init);
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const code = extractErrorCode(err);
      if (code === "ABORT_ERR" || (err instanceof Error && err.name === "AbortError")) {
        return {
          kind: "error",
          reason: signal?.aborted ? "aborted" : "url_dead",
          message: "fetch aborted (timeout or caller abort)",
        };
      }
      if (isTlsErrorCode(code)) {
        return {
          kind: "error",
          reason: "tls_error",
          message: code ?? "tls_error",
        };
      }
      if (
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN" ||
        code === "EAI_NODATA"
      ) {
        return { kind: "error", reason: "dns_error", message: code };
      }
      return {
        kind: "error",
        reason: "url_dead",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    // 405 / 501 → server doesn't like HEAD; fall back to GET-with-Range
    // once. Some misconfigured Nginx instances also reply with 400 on HEAD,
    // so we treat that the same way.
    if (
      method === "HEAD" &&
      allowGetFallback &&
      (response.status === 405 ||
        response.status === 501 ||
        response.status === 400)
    ) {
      method = "GET";
      allowGetFallback = false;
      // re-issue against the SAME url — no hop counted.
      continue;
    }

    // Redirect handling — 3xx with a Location header.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { kind: "response", response, finalUrl: currentUrl };
        }
        currentUrl = nextUrl;
        method = "HEAD";
        allowGetFallback = true;
        continue;
      }
      // No Location header → treat the 3xx as the terminal response.
    }

    return { kind: "response", response, finalUrl: currentUrl };
  }

  // Too many redirects — count as dead so we don't ship a video to a
  // redirect-loop page.
  return {
    kind: "error",
    reason: "url_dead",
    message: `exceeded ${MAX_REDIRECTS} redirects`,
  };
}

// Lazy import so this file remains tree-shakeable for tests that don't
// touch the parking-list.
async function checkParkingHost(host: string): Promise<boolean> {
  const { isParkingDomain } = await import("./parking-blacklist");
  return isParkingDomain(host);
}

/**
 * Probes a single URL. Always returns — never throws. Total wall-clock is
 * capped by the per-hop timeouts (DNS 3 s + up to 5 redirects × 5 s = ~28 s
 * worst case; typical successful probe is < 1 s).
 *
 * Schema-Handling: Lead-Listen enthalten oft nackte Domains ohne Schema.
 * Wir versuchen zuerst `https://`; scheitert das auf VERBINDUNGSEBENE
 * (TLS-Fehler oder Timeout/Refused — NICHT HTTP-4xx/5xx, Bot-Wall oder
 * Parking) UND die Original-URL hatte kein explizites Schema, probieren wir
 * einmal `http://` — manche alten Firmen-Sites haben schlicht kein TLS.
 *
 * Pass an `AbortSignal` to allow the BullMQ worker to cancel mid-flight
 * when the run is cancelled.
 */
export async function probeUrl(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<UrlProbeResult> {
  const startedAt = Date.now();

  const url = normaliseUrl(rawUrl);
  if (!url) {
    return {
      ok: false,
      status: "url_dead",
      httpStatus: null,
      finalUrl: null,
      durationMs: Date.now() - startedAt,
      errorMessage: "unparseable url",
    };
  }

  const hadExplicitScheme = /^https?:\/\//i.test((rawUrl ?? "").trim());
  const first = await probeParsedUrl(url, startedAt, signal);

  const connectionLevelFailure =
    (first.status === "tls_error" || first.status === "url_dead") &&
    first.httpStatus === null;
  if (
    connectionLevelFailure &&
    !hadExplicitScheme &&
    url.protocol === "https:" &&
    !signal?.aborted
  ) {
    const httpUrl = new URL(url.toString());
    httpUrl.protocol = "http:";
    const second = await probeParsedUrl(httpUrl, startedAt, signal);
    if (second.ok) return second;
  }

  return first;
}

async function probeParsedUrl(
  url: URL,
  startedAt: number,
  signal?: AbortSignal,
): Promise<UrlProbeResult> {
  // Stage 1 — DNS.
  const dnsRes = await resolveWithTimeout(url.hostname, signal);
  if (!dnsRes.ok) {
    return {
      ok: false,
      status: "dns_error",
      httpStatus: null,
      finalUrl: null,
      durationMs: Date.now() - startedAt,
      errorMessage: `dns: ${dnsRes.reason}`,
    };
  }

  // Stage 2 — HEAD/GET with redirect-follow.
  const hopRes = await doHeadFollow(url.toString(), signal, HTTP_TIMEOUT_MS);
  if (hopRes.kind === "error") {
    return {
      ok: false,
      status: hopRes.reason === "aborted" ? "url_dead" : hopRes.reason,
      httpStatus: null,
      finalUrl: null,
      durationMs: Date.now() - startedAt,
      errorMessage: hopRes.message,
    };
  }

  const { response, finalUrl } = hopRes;
  const httpStatus = response.status;

  // Drain the response body so the underlying socket can be released back
  // to the pool — without this, parallel-24 probes leak sockets fast.
  // We only used Range: bytes=0-2048 on the GET fallback, so this is cheap.
  try {
    if (response.body) await response.body.cancel();
  } catch {
    // best-effort cleanup; harmless if already drained
  }

  // Stage 3 — interpret the terminal response.
  if (isBotBlock(httpStatus, response.headers)) {
    return {
      ok: false,
      status: "bot_block",
      httpStatus,
      finalUrl,
      durationMs: Date.now() - startedAt,
      errorMessage: `bot-block (HTTP ${httpStatus}, server=${response.headers.get("server") ?? "?"})`,
    };
  }

  if (httpStatus >= 400) {
    return {
      ok: false,
      status: "url_dead",
      httpStatus,
      finalUrl,
      durationMs: Date.now() - startedAt,
      errorMessage: `HTTP ${httpStatus}`,
    };
  }

  // Stage 4 — parking-domain detection.
  let parkingHit = false;
  try {
    const finalHost = new URL(finalUrl).hostname;
    parkingHit = await checkParkingHost(finalHost);
  } catch {
    // unparseable final URL — treat as reachable (we already have a 2xx/3xx).
  }
  if (parkingHit) {
    return {
      ok: false,
      status: "url_redirect_parking",
      httpStatus,
      finalUrl,
      durationMs: Date.now() - startedAt,
      errorMessage: "final url is a parking domain",
    };
  }

  const durationMs = Date.now() - startedAt;
  if (durationMs > SLOW_THRESHOLD_MS) {
    // The URL is reachable but slow. This budget reflects the p99 of
    // measured website load times in our existing Phase-2 renders; sites
    // beyond it tend to produce broken scroll-captures.
    return {
      ok: false,
      status: "slow",
      httpStatus,
      finalUrl,
      durationMs,
      errorMessage: `total probe duration ${durationMs}ms > ${SLOW_THRESHOLD_MS}ms`,
    };
  }

  return {
    ok: true,
    status: "ok",
    httpStatus,
    finalUrl,
    durationMs,
    errorMessage: null,
  };
}
