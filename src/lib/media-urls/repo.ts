/**
 * Drizzle-Queries fuer media_urls. Strikt user-scoped — JEDE Query filtert
 * auf userId. Routen rufen das hier; keine direkten Drizzle-Calls in der UI.
 */

import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  mediaUrls,
  type MediaUrl,
  type NewMediaUrl,
} from "@/lib/db/schema";

export async function listUserMediaUrls(
  userId: string,
  opts?: { type?: MediaUrl["type"] },
): Promise<MediaUrl[]> {
  const conds: SQL[] = [eq(mediaUrls.userId, userId)];
  if (opts?.type) conds.push(eq(mediaUrls.type, opts.type));
  return db
    .select()
    .from(mediaUrls)
    .where(and(...conds))
    .orderBy(desc(mediaUrls.createdAt));
}

export async function getMediaUrl(
  id: string,
  userId: string,
): Promise<MediaUrl | null> {
  const rows = await db
    .select()
    .from(mediaUrls)
    .where(and(eq(mediaUrls.id, id), eq(mediaUrls.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMediaUrlByHash(
  userId: string,
  urlHash: string,
): Promise<MediaUrl | null> {
  const rows = await db
    .select()
    .from(mediaUrls)
    .where(and(eq(mediaUrls.userId, userId), eq(mediaUrls.urlHash, urlHash)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createMediaUrl(input: NewMediaUrl): Promise<MediaUrl> {
  const rows = await db.insert(mediaUrls).values(input).returning();
  return rows[0]!;
}

export async function deleteMediaUrl(
  id: string,
  userId: string,
): Promise<MediaUrl | null> {
  const rows = await db
    .delete(mediaUrls)
    .where(and(eq(mediaUrls.id, id), eq(mediaUrls.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function updateMediaUrlPreview(
  id: string,
  update: {
    previewBunnyPath?: string | null;
    previewUrl?: string | null;
    previewStatus: MediaUrl["previewStatus"];
    previewGeneratedAt?: Date | null;
    previewExpiresAt?: Date | null;
    lastError?: string | null;
  },
): Promise<void> {
  await db
    .update(mediaUrls)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(mediaUrls.id, id));
}
