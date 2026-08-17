/**
 * API-Key-Verwaltung (Mini-CRM Etappe 6b).
 *
 * - Klartext-Key beim Erstellen: "vc_live_<24-hex-random>". Prefix (die
 *   ersten 12 Chars inkl. "vc_live_") wird als Anzeige-Hinweis
 *   gespeichert, der volle Key nur als sha256-Hash.
 * - Auth-Lookup: sha256(bearer) → api_keys.key_hash. Rate-Limit +
 *   Idempotency laufen im /api/v1/…-Handler.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { apiKeys, type ApiKeyRow } from "@/lib/db/schema";

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  /** Klartext — wird NIEMALS wieder ausgegeben. */
  key: string;
  createdAt: string;
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Legt einen neuen API-Key an. Klartext-Key wird EINMAL zurückgegeben. */
export async function createApiKey(input: {
  userId: string;
  name: string;
}): Promise<CreatedApiKey> {
  const secret = randomBytes(18).toString("hex"); // 36 hex chars
  const raw = `vc_live_${secret}`;
  const prefix = raw.slice(0, 12); // "vc_live_a1b2"
  const hash = hashKey(raw);

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: input.userId,
      name: input.name.trim() || "Automation-Key",
      keyPrefix: prefix,
      keyHash: hash,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    key: raw,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    usageCount: number;
    createdAt: string;
    revokedAt: string | null;
  }>
> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      usageCount: apiKeys.usageCount,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(sql`${apiKeys.createdAt} DESC`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    usageCount: r.usageCount,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(input: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, input.userId)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/** Auth: bekommt den Klartext-Bearer, findet den Key (nur nicht revoked). */
export async function authenticateApiKey(rawToken: string): Promise<ApiKeyRow | null> {
  if (!rawToken || !rawToken.startsWith("vc_live_")) return null;
  const hash = hashKey(rawToken);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** Nach erfolgreichem Request: last_used_at + usage_count + optional
 *  Idempotency-Cache aktualisieren. */
export async function bumpApiKeyUsage(input: {
  id: string;
  idempotencyKey?: string;
  responseJson?: string;
}): Promise<void> {
  if (input.idempotencyKey && input.responseJson) {
    // Neuer Eintrag im recent_idempotency-Array, alte >24h weg-trimmen.
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    await db.execute(sql`
      UPDATE api_keys
         SET last_used_at = now(),
             usage_count  = usage_count + 1,
             recent_idempotency = (
               SELECT jsonb_agg(elem)
                 FROM (
                   SELECT elem FROM jsonb_array_elements(
                     COALESCE(recent_idempotency, '[]'::jsonb)
                     || jsonb_build_array(jsonb_build_object(
                       'key', ${input.idempotencyKey}::text,
                       'responseJson', ${input.responseJson}::text,
                       'at', now()::text))
                   ) AS elem
                  WHERE (elem->>'at')::timestamptz >= ${cutoff}::timestamptz
                 ) sub
             )
       WHERE id = ${input.id}
    `);
  } else {
    await db
      .update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        usageCount: sql`${apiKeys.usageCount} + 1`,
      })
      .where(eq(apiKeys.id, input.id));
  }
}

/** Idempotency-Lookup: gibt ggf. cachedResponse zurück wenn key bereits
 *  in den letzten 24h verwendet wurde. */
export function findIdempotentResponse(
  key: ApiKeyRow,
  idempotencyKey: string,
): string | null {
  const arr = key.recentIdempotency ?? [];
  const cutoff = Date.now() - 24 * 3600_000;
  for (const e of arr) {
    if (e.key === idempotencyKey && new Date(e.at).getTime() >= cutoff) {
      return e.responseJson;
    }
  }
  return null;
}
