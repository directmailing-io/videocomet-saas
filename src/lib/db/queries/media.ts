import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaItems } from "@/lib/db/schema";

export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type MediaType = "webcam" | "image" | "video" | "logo";

export type CreateMediaInput = Omit<NewMediaItem, "id" | "userId" | "createdAt">;

export async function createMediaItem(
  userId: string,
  input: CreateMediaInput,
): Promise<MediaItem> {
  const [row] = await db
    .insert(mediaItems)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create media item");
  return row;
}

export async function deleteMediaItem(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(mediaItems)
    .where(and(eq(mediaItems.id, id), eq(mediaItems.userId, userId)))
    .returning({ id: mediaItems.id });
  if (result.length === 0) throw new Error("Not found");
}

/**
 * Lists media items for a user. `type` may be:
 *   - undefined  → all types
 *   - MediaType  → exactly this type (backwards-compatible)
 *   - MediaType[] → any of these types (uses SQL `IN (...)`)
 *
 * An empty array yields no rows (rather than throwing or behaving like
 * "all types") — that way callers can pass a derived list without
 * surprising results when it happens to be empty.
 */
export async function listUserMedia(
  userId: string,
  type?: MediaType | ReadonlyArray<MediaType>,
): Promise<MediaItem[]> {
  let where;
  if (Array.isArray(type)) {
    if (type.length === 0) return [];
    // De-duplicate so the SQL `IN` list stays tidy when callers pass
    // ["webcam","webcam"] from a CSV parser etc.
    const uniqueTypes = Array.from(new Set(type)) as MediaType[];
    where = uniqueTypes.length === 1
      ? and(eq(mediaItems.userId, userId), eq(mediaItems.type, uniqueTypes[0]!))
      : and(eq(mediaItems.userId, userId), inArray(mediaItems.type, uniqueTypes));
  } else if (typeof type === "string") {
    where = and(eq(mediaItems.userId, userId), eq(mediaItems.type, type));
  } else {
    where = eq(mediaItems.userId, userId);
  }
  return db
    .select()
    .from(mediaItems)
    .where(where)
    .orderBy(desc(mediaItems.createdAt));
}

export async function getMediaItem(id: string, userId: string): Promise<MediaItem> {
  const [row] = await db
    .select()
    .from(mediaItems)
    .where(and(eq(mediaItems.id, id), eq(mediaItems.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Benennt ein Media-Item um. Validiert Ownership über (id, userId).
 * Liefert true wenn das Update einen Treffer hatte.
 */
export async function renameMediaItem(
  id: string,
  userId: string,
  newName: string,
): Promise<MediaItem | null> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("name-empty");
  if (trimmed.length > 200) throw new Error("name-too-long");
  const result = await db
    .update(mediaItems)
    .set({ name: trimmed })
    .where(and(eq(mediaItems.id, id), eq(mediaItems.userId, userId)))
    .returning();
  return result[0] ?? null;
}
