import { and, desc, eq } from "drizzle-orm";
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
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
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

export async function getCampaign(id: string, userId: string): Promise<Campaign> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listUserCampaigns(userId: string): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
}
