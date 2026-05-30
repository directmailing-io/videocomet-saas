export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/track/event
 *
 * Public, unauthenticated tracking endpoint called from the rendered
 * landingpages / video-players. Replaces the older per-kind endpoints
 * (page-view, video-start, video-progress, cta-click) with a single body-
 * driven event sink.
 *
 * Body:
 *   { slug: string, kind: LeadEventKind, payload?: object }
 *
 * Response:
 *   204 No Content      — accepted (event queued to insertLeadEvent)
 *   400 Bad Request     — bad shape / unknown kind / payload too big
 *   404 Not Found       — slug does not match a known lead (silent for client; we still return 204 to keep the public surface noise-free)
 *   429 Too Many Reqs   — rate-limit exceeded (>60 events / session / minute)
 *
 * CORS: Access-Control-Allow-Origin: * — landingpages are normally served
 * from our domain but sendBeacon may still see a cross-origin context
 * (preview deploys, custom domains). Keep open to avoid silent drops.
 *
 * The insert+aggregate is fire-and-forget: we return the response BEFORE
 * awaiting `insertLeadEvent` so the client never waits on DB latency.
 */

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  insertLeadEvent,
  isLeadEventKind,
  getLeadIdBySlug,
  type LeadEventKind,
} from "@/lib/db/queries/lead-events";
import { getClientIp } from "@/lib/tracking";

const MAX_PAYLOAD_BYTES = 2048;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SEC = 60;

// ── CORS helpers ────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(status: number, body?: BodyInit | null): Response {
  return new Response(body ?? null, { status, headers: CORS_HEADERS });
}

// ── Slug → leadId cache (60s TTL) ───────────────────────────────────────────
// Cheap in-memory cache so the same slug doesn't hammer the DB during a
// landingpage's tracking burst. Hit rate is high because each visitor fires
// 1 page_view + N progress events all against the same slug.
const SLUG_CACHE_TTL_MS = 60_000;
const slugCache = new Map<string, { leadId: string | null; expiresAt: number }>();

async function resolveSlugToLeadId(slug: string): Promise<string | null> {
  const now = Date.now();
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > now) return cached.leadId;

  const leadId = await getLeadIdBySlug(slug);
  slugCache.set(slug, { leadId, expiresAt: now + SLUG_CACHE_TTL_MS });
  // Soft-evict expired entries on each insert so the map can't grow forever
  // under attack. Cheap O(n) sweep — n stays small in practice (<10k slugs).
  if (slugCache.size > 5000) {
    Array.from(slugCache.entries()).forEach(([k, v]) => {
      if (v.expiresAt <= now) slugCache.delete(k);
    });
  }
  return leadId;
}

// ── Hash helpers ────────────────────────────────────────────────────────────
function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function computeSessionId(ip: string, ua: string): string {
  // Rotating-daily session id — gives us a stable identifier within a day for
  // rate-limit + watch-time bucketing without enabling long-term cross-day
  // tracking of an individual visitor. (Privacy by design.)
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return shortHash(`${ip}|${ua}|${day}`);
}

// ── Rate limit ──────────────────────────────────────────────────────────────
// Use the worker's lazy ioredis connection (same instance that powers
// BullMQ). Falls back to an in-process counter if Redis is unreachable so
// the endpoint stays up — better to over-accept than to drop events.
const memoryRateLimit = new Map<string, { count: number; resetAt: number }>();

async function checkRateLimit(sessionId: string): Promise<{ allowed: boolean }> {
  const key = `track:ratelimit:${sessionId}`;
  try {
    const { getRedisConnection } = await import("@/worker/queue");
    const redis = getRedisConnection();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
    }
    return { allowed: count <= RATE_LIMIT_MAX };
  } catch {
    // Redis unavailable — fall back to in-memory limiter so we still throttle
    // the most obvious flooders per-instance. Not perfect across pods, but
    // better than no limit while the public endpoint stays available.
    const now = Date.now();
    const entry = memoryRateLimit.get(sessionId);
    if (!entry || entry.resetAt <= now) {
      memoryRateLimit.set(sessionId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_SEC * 1000,
      });
      return { allowed: true };
    }
    entry.count += 1;
    return { allowed: entry.count <= RATE_LIMIT_MAX };
  }
}

// ── Validation ──────────────────────────────────────────────────────────────
interface ParsedBody {
  slug: string;
  kind: LeadEventKind;
  payload?: Record<string, unknown>;
}

function parseBody(raw: unknown): ParsedBody | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const slug = typeof obj.slug === "string" ? obj.slug.trim() : "";
  const kind = obj.kind;
  if (!slug || slug.length > 200) return null;
  if (!isLeadEventKind(kind)) return null;

  let payload: Record<string, unknown> | undefined;
  if (obj.payload != null) {
    if (typeof obj.payload !== "object" || Array.isArray(obj.payload)) {
      return null;
    }
    payload = obj.payload as Record<string, unknown>;
    // Payload size guard — sanity cap so a misbehaving client can't push
    // multi-MB blobs into the events table.
    try {
      const serialized = JSON.stringify(payload);
      if (serialized.length > MAX_PAYLOAD_BYTES) return null;
    } catch {
      return null;
    }
  }
  return { slug, kind, payload };
}

// ── Handlers ────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<Response> {
  return corsResponse(204);
}

export async function POST(req: NextRequest): Promise<Response> {
  // Parse body (cheap; do this first so we can reject garbage early).
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return corsResponse(400);
  }
  const parsed = parseBody(bodyRaw);
  if (!parsed) return corsResponse(400);

  // Resolve session + ip-hash.
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") ?? "";
  const sessionId = computeSessionId(ip, ua);
  const ipHash = ip ? shortHash(ip) : "";

  // Rate-limit per session.
  const { allowed } = await checkRateLimit(sessionId);
  if (!allowed) return corsResponse(429);

  // Resolve slug → leadId (cached 60s). We silently 204 for unknown slugs so
  // probes for non-existent slugs don't leak a "is this slug taken?" oracle.
  const leadId = await resolveSlugToLeadId(parsed.slug);
  if (!leadId) return corsResponse(204);

  // Fire and forget: kick off the insert+aggregate without awaiting, so the
  // client gets a sub-50ms response regardless of DB roundtrip.
  void insertLeadEvent({
    leadId,
    kind: parsed.kind,
    payload: parsed.payload,
    sessionId,
    ipHash,
  });

  return corsResponse(204);
}
