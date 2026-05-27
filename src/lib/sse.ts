/**
 * Tiny Server-Sent Events helper for Next.js route handlers.
 *
 * Usage:
 *
 *   return createSSEResponse(async (send, close) => {
 *     send("status", { foo: "bar" });
 *     await wait(2000);
 *     close();
 *   });
 */

/**
 * Encodes a single SSE frame: `event: <name>\ndata: <json>\n\n`.
 */
function frame(event: string, payload: unknown): Uint8Array {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  const text = `event: ${event}\ndata: ${json}\n\n`;
  return new TextEncoder().encode(text);
}

export type SSESend = (event: string, data: unknown) => void;
export type SSEHandler = (send: SSESend, close: () => void, signal: AbortSignal) => Promise<void> | void;

/**
 * Wraps an async handler in a streaming Response suitable for SSE.
 *
 *  - `Cache-Control: no-cache, no-transform` so proxies don't buffer.
 *  - `X-Accel-Buffering: no` for nginx.
 *  - `Connection: keep-alive` for direct deployments.
 *  - Sends an initial `retry: 5000` so disconnected clients reconnect quickly.
 *
 * The handler receives a `send(event, data)` function, a `close()` function
 * to terminate the stream and an `AbortSignal` that fires when the client
 * disconnects. Errors thrown from the handler propagate to the stream as a
 * single `event: error` frame before closing.
 */
export function createSSEResponse(
  handler: SSEHandler,
  init?: { headers?: Record<string, string> },
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const ac = new AbortController();

      const send: SSESend = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event, data));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        ac.abort();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Initial retry hint + ping so the connection is "live" immediately.
      controller.enqueue(new TextEncoder().encode("retry: 5000\n\n"));

      try {
        await handler(send, close, ac.signal);
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(init?.headers ?? {}),
    },
  });
}
