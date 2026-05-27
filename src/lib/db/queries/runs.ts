import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type CreateRunInput = Omit<NewRun, "id" | "userId" | "createdAt">;

export type UpdateRunPatch = Partial<Omit<Run, "id" | "userId" | "createdAt">>;

export async function createRun(userId: string, input: CreateRunInput): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create run");
  return row;
}

export async function updateRun(
  id: string,
  userId: string,
  patch: UpdateRunPatch,
): Promise<Run> {
  const [row] = await db
    .update(runs)
    .set(patch)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

export async function deleteRun(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .returning({ id: runs.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getRun(id: string, userId: string): Promise<Run> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listCampaignRuns(
  campaignId: string,
  userId: string,
): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.campaignId, campaignId), eq(runs.userId, userId)))
    .orderBy(desc(runs.createdAt));
}
