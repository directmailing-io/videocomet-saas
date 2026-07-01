export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { listTransactions } from "@/lib/billing/credit-service";
import { CREDIT_PACKAGES } from "@/lib/billing/stripe-client";

/**
 * GET /api/billing/status
 *
 * Liefert alles was UI (Sidebar, Wizard-Estimate, Einstellungen-Tab)
 * ueber die aktuelle Billing-Situation wissen muss.
 */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({
      creditBalance: users.creditBalance,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);

  const transactions = await listTransactions({
    userId: auth.user.id,
    limit: 20,
  });

  return NextResponse.json({
    creditBalance: row?.creditBalance ?? 0,
    subscription: {
      status: row?.subscriptionStatus ?? null,
      currentPeriodEnd: row?.subscriptionCurrentPeriodEnd
        ? row.subscriptionCurrentPeriodEnd.toISOString()
        : null,
      hasStripeAccount: Boolean(row?.stripeCustomerId),
    },
    packages: CREDIT_PACKAGES,
    transactions: transactions.map((t) => ({
      id: String(t.id),
      kind: t.kind,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}
