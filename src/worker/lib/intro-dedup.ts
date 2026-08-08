/**
 * Anrede-Dedup (W4): identische Begrüßungen nur EINMAL generieren.
 *
 * Der Cache-Schlüssel umfasst alles, was den Engine-Output bestimmt:
 * aufgelöster TTS-Text, Fish-Voice-Model, Webcam-Video und der
 * Kalibrierungs-Stand (updatedAt — jede Neu-Kalibrierung invalidiert).
 *
 * Claim-Protokoll auf `intro_cache` (UNIQUE (user_id, cache_key)):
 *   - INSERT ... ON CONFLICT DO NOTHING gewinnt → role='generate'.
 *   - Bestehende Row status='ready' → role='hit' (Ergebnis wiederverwenden;
 *     die Ziel-URL wird per HEAD verifiziert, damit ein gelöschtes Bunny-
 *     Asset nie in einen Lead kopiert wird).
 *   - Bestehende Row status='pending' und frisch → role='wait' (Caller
 *     verzögert seinen Job und prüft später erneut).
 *   - pending älter als PENDING_STALE_MS → Übernahme (Generator ist
 *     abgestürzt); atomar via UPDATE ... WHERE updated_at < threshold.
 *
 * Fehlerpfade des Generators MÜSSEN releaseIntroCacheClaim() aufrufen,
 * sonst warten Konkurrenten bis zur Stale-Übernahme.
 */

import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { introCache, type LeadIntroResult } from "@/lib/db/schema";

/**
 * pending-Claims älter als das gelten als verwaist. Muss großzügig über dem
 * Engine-Hard-Timeout (8 min) + Bunny-Upload liegen.
 */
const PENDING_STALE_MS = 12 * 60 * 1000;

export function computeIntroCacheKey(opts: {
  ttsText: string;
  fishModelId: string;
  webcamMediaId: string;
  calibrationUpdatedAt: Date;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        opts.ttsText,
        opts.fishModelId,
        opts.webcamMediaId,
        opts.calibrationUpdatedAt.toISOString(),
      ]),
    )
    .digest("hex");
}

export type IntroCacheClaim =
  | { role: "generate" }
  | { role: "hit"; result: LeadIntroResult }
  | { role: "wait" };

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function claimIntroCache(
  userId: string,
  cacheKey: string,
): Promise<IntroCacheClaim> {
  const inserted = await db
    .insert(introCache)
    .values({ userId, cacheKey, status: "pending" })
    .onConflictDoNothing()
    .returning({ id: introCache.id });
  if (inserted.length > 0) return { role: "generate" };

  const [existing] = await db
    .select()
    .from(introCache)
    .where(and(eq(introCache.userId, userId), eq(introCache.cacheKey, cacheKey)))
    .limit(1);
  // Row zwischen INSERT und SELECT verschwunden (Generator-Release) —
  // neu claimen.
  if (!existing) return claimIntroCache(userId, cacheKey);

  if (existing.status === "ready" && existing.result?.url) {
    // Asset kann extern gelöscht worden sein (Bunny-Cleanup, Incident) —
    // dann Eintrag verwerfen und selbst generieren.
    if (await headOk(existing.result.url)) {
      return { role: "hit", result: existing.result };
    }
    await db.delete(introCache).where(eq(introCache.id, existing.id));
    return claimIntroCache(userId, cacheKey);
  }

  // pending: frisch → warten; verwaist → übernehmen.
  const staleBefore = new Date(Date.now() - PENDING_STALE_MS);
  if (existing.updatedAt >= staleBefore) return { role: "wait" };
  const takeover = await db
    .update(introCache)
    .set({ updatedAt: sql`now()` })
    .where(
      and(
        eq(introCache.id, existing.id),
        eq(introCache.status, "pending"),
        lt(introCache.updatedAt, staleBefore),
      ),
    )
    .returning({ id: introCache.id });
  if (takeover.length > 0) return { role: "generate" };
  return { role: "wait" };
}

export async function markIntroCacheReady(
  userId: string,
  cacheKey: string,
  result: LeadIntroResult,
): Promise<void> {
  await db
    .update(introCache)
    .set({ status: "ready", result, updatedAt: sql`now()` })
    .where(and(eq(introCache.userId, userId), eq(introCache.cacheKey, cacheKey)));
}

/**
 * Gibt einen pending-Claim frei (Generator-Fehlpfad), damit Wartende sofort
 * selbst generieren können. Rührt fertige Einträge nie an.
 */
export async function releaseIntroCacheClaim(
  userId: string,
  cacheKey: string,
): Promise<void> {
  await db
    .delete(introCache)
    .where(
      and(
        eq(introCache.userId, userId),
        eq(introCache.cacheKey, cacheKey),
        eq(introCache.status, "pending"),
      ),
    );
}
