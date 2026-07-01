export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  findOrCreateCustomer,
  getPriceIds,
  getStripe,
  CREDIT_PACKAGES,
} from "@/lib/billing/stripe-client";

/**
 * POST /api/billing/credits/create-checkout
 *
 * Body: { package: "credits_50" | "credits_100" | "credits_500" }
 *
 * Erstellt eine One-Time-Payment-Checkout-Session. Nach Erfolg loest der
 * Stripe-Webhook `checkout.session.completed` (Mode=payment) den
 * Credit-Grant aus.
 */
const BODY = z.object({
  package: z.enum(["credits_50", "credits_100", "credits_500"]),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  const pkg = CREDIT_PACKAGES.find((p) => p.id === parsed.data.package);
  if (!pkg) return NextResponse.json({ error: "Paket nicht gefunden" }, { status: 400 });

  const [row] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      companyName: users.companyName,
      vatId: users.vatId,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "User nicht gefunden" }, { status: 404 });

  const customerId = await findOrCreateCustomer({
    userId: auth.user.id,
    email: row.email,
    name:
      row.companyName ||
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      null,
    vatId: row.vatId ?? null,
    existingCustomerId: row.stripeCustomerId ?? null,
  });
  if (!row.stripeCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(and(eq(users.id, auth.user.id)));
  }

  const stripe = getStripe();
  const prices = getPriceIds();
  const priceMap: Record<typeof parsed.data.package, string> = {
    credits_50: prices.credits50,
    credits_100: prices.credits100,
    credits_500: prices.credits500,
  };
  const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
    /\/+$/,
    "",
  );

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceMap[parsed.data.package], quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    payment_method_types: ["card", "sepa_debit"],
    billing_address_collection: "required",
    // Metadata sind essentiell: der Webhook muss wissen wieviele Credits
    // gutgeschrieben werden und fuer welchen User.
    metadata: {
      userId: auth.user.id,
      kind: "topup",
      credits: String(pkg.credits),
      packageId: pkg.id,
    },
    payment_intent_data: {
      metadata: {
        userId: auth.user.id,
        credits: String(pkg.credits),
      },
    },
    success_url: `${appOrigin}/einstellungen?tab=abrechnung&topup=success`,
    cancel_url: `${appOrigin}/einstellungen?tab=abrechnung&topup=cancel`,
  });

  return NextResponse.json({ url: session.url }, { status: 200 });
}
