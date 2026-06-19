/**
 * Mini-Helpers für die Provider-Tests.
 *
 * Wir mocken `globalThis.fetch` mit einem Recorder, der jeden Request
 * inkl. Method/URL/Headers/Body protokolliert und auf eine konfigurier-
 * bare Antwort-Queue mapped. msw ist aktuell nicht installiert; das
 * Recorder-Pattern reicht für die Coverage-Ziele dieser Phase voll aus.
 */
import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

function headersToRecord(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

function buildResponse(spec: MockResponseSpec): Response {
  const status = spec.status ?? 200;
  const body =
    spec.text !== undefined
      ? spec.text
      : spec.json !== undefined
        ? JSON.stringify(spec.json)
        : "";
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      ...(spec.headers ?? {}),
    },
  });
}

export interface FetchMock {
  requests: RecordedRequest[];
  restore: () => void;
}

/**
 * Mockt `fetch` global. `responder` darf wahlweise ein Array sein, das
 * pro Aufruf nacheinander konsumiert wird, ODER eine Funktion, die pro
 * Request entscheidet, was sie zurückgibt.
 */
export function installFetchMock(
  responder:
    | MockResponseSpec[]
    | ((req: RecordedRequest) => MockResponseSpec | Promise<MockResponseSpec>),
): FetchMock {
  const requests: RecordedRequest[] = [];
  const queue = Array.isArray(responder) ? [...responder] : null;
  const original = globalThis.fetch;

  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const recorded: RecordedRequest = {
      url,
      method,
      headers: headersToRecord(init),
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(recorded);

    let spec: MockResponseSpec;
    if (queue) {
      const next = queue.shift();
      if (!next) {
        throw new Error(
          `installFetchMock: response queue exhausted (${method} ${url})`,
        );
      }
      spec = next;
    } else if (typeof responder === "function") {
      spec = await responder(recorded);
    } else {
      throw new Error("installFetchMock: invalid responder");
    }
    return buildResponse(spec);
  });

  globalThis.fetch = stub as unknown as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
