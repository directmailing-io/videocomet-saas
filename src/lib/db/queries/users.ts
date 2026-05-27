import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import argon2 from "argon2";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type UserRole = "admin" | "user";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export interface CreateUserInput {
  email: string;
  password: string;
  role?: UserRole;
  isActive?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  companyName?: string | null;
  vatId?: string | null;
  billingStreet?: string | null;
  billingZip?: string | null;
  billingCity?: string | null;
  billingCountry?: string | null;
}

export type UpdateUserPatch = Partial<
  Omit<User, "id" | "passwordHash" | "createdAt" | "updatedAt">
>;

export interface ListUsersOptions {
  search?: string;
  role?: UserRole;
  limit?: number;
  offset?: number;
}

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase().trim(),
      passwordHash,
      role: input.role ?? "user",
      isActive: input.isActive ?? true,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      vatId: input.vatId ?? null,
      billingStreet: input.billingStreet ?? null,
      billingZip: input.billingZip ?? null,
      billingCity: input.billingCity ?? null,
      billingCountry: input.billingCountry ?? "DE",
    })
    .returning();
  if (!row) throw new Error("Failed to create user");
  return row;
}

export async function updateUser(id: string, patch: UpdateUserPatch): Promise<User> {
  const [row] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

export async function deleteUser(id: string): Promise<void> {
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getUserById(id: string): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

export async function listUsers(options: ListUsersOptions = {}): Promise<{
  items: User[];
  total: number;
}> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const filters = [];
  if (options.role) filters.push(eq(users.role, options.role));
  if (options.search) {
    const needle = `%${options.search.trim()}%`;
    filters.push(
      or(
        ilike(users.email, needle),
        ilike(users.firstName, needle),
        ilike(users.lastName, needle),
        ilike(users.companyName, needle),
      )!,
    );
  }
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const items = await db
    .select()
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt), asc(users.email))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(whereClause);

  return { items, total: count ?? 0 };
}

export async function activateUser(id: string): Promise<User> {
  return updateUser(id, { isActive: true });
}

export async function deactivateUser(id: string): Promise<User> {
  return updateUser(id, { isActive: false });
}

export async function setUserPassword(id: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  const result = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (result.length === 0) throw new Error("Not found");
}
