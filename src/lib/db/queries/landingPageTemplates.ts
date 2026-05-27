import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { landingPageTemplates } from "@/lib/db/schema";

export type LandingPageTemplate = typeof landingPageTemplates.$inferSelect;
export type NewLandingPageTemplate = typeof landingPageTemplates.$inferInsert;

export type CreateTplInput = Omit<
  NewLandingPageTemplate,
  "id" | "userId" | "createdAt" | "updatedAt"
>;

export type UpdateTplPatch = Partial<
  Omit<LandingPageTemplate, "id" | "userId" | "createdAt" | "updatedAt">
>;

export async function createTpl(
  userId: string,
  input: CreateTplInput,
): Promise<LandingPageTemplate> {
  const [row] = await db
    .insert(landingPageTemplates)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create landing page template");
  return row;
}

export async function updateTpl(
  id: string,
  userId: string,
  patch: UpdateTplPatch,
): Promise<LandingPageTemplate> {
  const [row] = await db
    .update(landingPageTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(landingPageTemplates.id, id), eq(landingPageTemplates.userId, userId)),
    )
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

export async function deleteTpl(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(landingPageTemplates)
    .where(
      and(eq(landingPageTemplates.id, id), eq(landingPageTemplates.userId, userId)),
    )
    .returning({ id: landingPageTemplates.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getTpl(
  id: string,
  userId: string,
): Promise<LandingPageTemplate> {
  const [row] = await db
    .select()
    .from(landingPageTemplates)
    .where(
      and(eq(landingPageTemplates.id, id), eq(landingPageTemplates.userId, userId)),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listUserTpls(userId: string): Promise<LandingPageTemplate[]> {
  return db
    .select()
    .from(landingPageTemplates)
    .where(eq(landingPageTemplates.userId, userId))
    .orderBy(desc(landingPageTemplates.createdAt));
}
