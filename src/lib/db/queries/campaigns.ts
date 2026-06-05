import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type CreateCampaignInput = Omit<
  NewCampaign,
  "id" | "userId" | "createdAt" | "updatedAt"
>;

export type UpdateCampaignPatch = Partial<
  Omit<Campaign, "id" | "userId" | "createdAt" | "updatedAt">
>;

export async function createCampaign(
  userId: string,
  input: CreateCampaignInput,
): Promise<Campaign> {
  const [row] = await db
    .insert(campaigns)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create campaign");
  return row;
}

export async function updateCampaign(
  id: string,
  userId: string,
  patch: UpdateCampaignPatch,
): Promise<Campaign> {
  const [row] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

export async function deleteCampaign(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .returning({ id: campaigns.id });
  if (result.length === 0) throw new Error("Not found");
}

/**
 * Soft-Delete: setzt `deletedAt`, entfernt KEINE FK-Children. Idempotent —
 * ein erneuter Aufruf auf einer bereits soft-deleted Row liefert weiterhin
 * "Not found" (Filter `deletedAt IS NULL`). Der Caller ist verantwortlich
 * dafür, die `bunny_asset_refs` der zugehörigen Owner zu entfernen; der
 * Background-Purge-Worker übernimmt danach das Bunny-Cleanup.
 */
export async function softDeleteCampaign(
  id: string,
  userId: string,
): Promise<void> {
  const result = await db
    .update(campaigns)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .returning({ id: campaigns.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getCampaign(id: string, userId: string): Promise<Campaign> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, id),
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listUserCampaigns(userId: string): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), isNull(campaigns.deletedAt)))
    .orderBy(desc(campaigns.createdAt));
}
