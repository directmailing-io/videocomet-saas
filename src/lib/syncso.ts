/**
 * sync.so API-Client (Lip-Sync, Model `lipsync-2`).
 *
 * Base: https://api.sync.so/v2
 * Auth: `x-api-key: <SYNCSO_API_KEY>`
 *
 * Cloudflare-Quirk: sync.so sitzt hinter Cloudflare-Bot-Protection —
 * python-urllib bekam 403 (error 1010), curl ging durch. Node-fetch
 * schicken wir deshalb mit einem realistischen User-Agent; wenn Cloudflare
 * trotzdem mit 403 blockt, fällt der Client automatisch auf ein
 * gespawntes `curl` zurück (siehe `scripts/smoke-syncso.ts`).
 */

import { spawn } from "node:child_process";

const SYNCSO_API_BASE = "https://api.sync.so/v2";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function apiKey(): string {
  const key = process.env.SYNCSO_API_KEY;
  if (!key) throw new Error("SYNCSO_API_KEY is required");
  return key;
}

export type SyncsoStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED";

export interface SyncsoGeneration {
  id: string;
  status: SyncsoStatus;
  outputUrl: string | null;
  error: string | null;
}

interface RequestOpts {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

function curlFallback(opts: RequestOpts): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-X",
      opts.method,
      "-H",
      `x-api-key: ${apiKey()}`,
      "-H",
      "Content-Type: application/json",
      "-H",
      `User-Agent: ${USER_AGENT}`,
      "-w",
      "\n%{http_code}",
      `${SYNCSO_API_BASE}${opts.path}`,
    ];
    if (opts.body !== undefined) {
      args.push("-d", JSON.stringify(opts.body));
    }
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`[syncso] curl exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      const idx = stdout.lastIndexOf("\n");
      const status = Number(stdout.slice(idx + 1).trim());
      resolve({ status, text: stdout.slice(0, idx) });
    });
  });
}

/**
 * Führt einen sync.so-Request aus: erst Node-fetch (mit Browser-UA);
 * bei Cloudflare-403 automatisch curl-Fallback.
 */
async function syncsoRequest(opts: RequestOpts): Promise<unknown> {
  let status: number;
  let text: string;
  try {
    const res = await fetch(`${SYNCSO_API_BASE}${opts.path}`, {
      method: opts.method,
      headers: {
        "x-api-key": apiKey(),
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    console.warn("[syncso] fetch failed, falling back to curl:", (err as Error).message);
    ({ status, text } = await curlFallback(opts));
  }

  if (status === 403 && /cloudflare|error 10\d\d|attention required/i.test(text)) {
    console.warn("[syncso] Cloudflare 403 via fetch — retrying with curl");
    ({ status, text } = await curlFallback(opts));
  }

  if (status < 200 || status >= 300) {
    throw new Error(`[syncso] ${opts.method} ${opts.path} failed: HTTP ${status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

function parseGeneration(raw: unknown): SyncsoGeneration {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? ""),
    status: String(obj.status ?? "PENDING") as SyncsoStatus,
    outputUrl: typeof obj.outputUrl === "string" ? obj.outputUrl : null,
    error: typeof obj.error === "string" ? obj.error : null,
  };
}

/**
 * sync_mode steuert, wie sync.so Längen-Differenzen zwischen Video und
 * Audio auflöst:
 *   - "cut_off": auf das kürzere Ende schneiden (Default, Video==Audio-Länge)
 *   - "bounce": Video vorwärts/rückwärts spiegeln bis es die Audio-Länge
 *     erreicht — genutzt wenn die TTS-Begrüßung länger ist als die
 *     Original-Anrede-Zone (Video wird lippensynchron VERLÄNGERT statt
 *     die TTS zu beschleunigen).
 */
export type SyncsoSyncMode = "cut_off" | "bounce" | "loop" | "silence" | "remap";

/**
 * Account-weites Concurrency-Limit erreicht (429 concurrency_limit_reached).
 *
 * Früher hat `createGeneration` hier bis zu 8 Minuten blind gepollt und
 * damit den Render-Worker blockiert. Jetzt wird der Fehler typisiert nach
 * oben gereicht (`retryable = true`) — die Intro-Staging-Queue retryt mit
 * BullMQ-Backoff, statt einen Worker-Slot zu belegen.
 */
export class SyncsoConcurrencyError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "SyncsoConcurrencyError";
  }
}

export async function createGeneration(input: {
  videoUrl: string;
  audioUrl: string;
  syncMode?: SyncsoSyncMode;
}): Promise<SyncsoGeneration> {
  try {
    const raw = await syncsoRequest({
      method: "POST",
      path: "/generate",
      body: {
        model: "lipsync-2",
        input: [
          { type: "video", url: input.videoUrl },
          { type: "audio", url: input.audioUrl },
        ],
        options: { sync_mode: input.syncMode ?? "cut_off" },
      },
    });
    return parseGeneration(raw);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("HTTP 429") && msg.includes("concurrency_limit")) {
      throw new SyncsoConcurrencyError(msg);
    }
    throw err;
  }
}

export async function getGeneration(id: string): Promise<SyncsoGeneration> {
  const raw = await syncsoRequest({
    method: "GET",
    path: `/generate/${encodeURIComponent(id)}`,
  });
  return parseGeneration(raw);
}
