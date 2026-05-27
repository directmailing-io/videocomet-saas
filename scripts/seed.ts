/**
 * Seed-Script: legt den initialen Admin-User an.
 *
 * ENV:
 *   - DATABASE_URL
 *   - ADMIN_SEED_EMAIL
 *   - ADMIN_SEED_PASSWORD
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import argon2 from "argon2";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

async function main(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email) throw new Error("ADMIN_SEED_EMAIL is required");
  if (!password) throw new Error("ADMIN_SEED_PASSWORD is required");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    console.log("✓ Admin exists, skipping");
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await db.insert(users).values({
    email,
    passwordHash,
    role: "admin",
    isActive: true,
    firstName: "Daniel",
    lastName: "Kurzeja",
  });

  console.log("✓ Admin created");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
