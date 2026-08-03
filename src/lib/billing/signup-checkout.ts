import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  findOrCreateCustomer,
  getPriceIds,
  getStripe,
} from "@/lib/billing/stripe-client";

export function marketingOrigin(): string {
  return (process.env.MARKETING_URL ?? "https://videocomet.de").replace(/\/+$/, "");
}

/**
 * Erstellt die Subscription-Checkout-Session fuer den Signup-Flow
 * (Marketing-Domain als Return-URL). Genutzt vom Signup-Endpoint (bereits
 * verifizierte E-Mail) und vom Verify-Link (frisch verifiziert).
 */
export async function createSignupCheckout(input: {
  userId: string;
  email: string;
  name: string | null;
  vatId: string | null;
  existingCustomerId: string | null;
}): Promise<string> {
  const customerId = await findOrCreateCustomer({
    userId: input.userId,
    email: input.email,
    name: input.name,
    vatId: input.vatId,
    existingCustomerId: input.existingCustomerId,
  });
  if (customerId !== input.existingCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
  }

  const stripe = getStripe();
  const { subscription: subPriceId } = getPriceIds();
  const origin = marketingOrigin();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: subPriceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    // payment_method_types bewusst nicht gesetzt — Stripe nutzt automatisch
    // die im Dashboard aktivierten Methoden.
    billing_address_collection: "required",
    metadata: { userId: input.userId, kind: "subscription" },
    subscription_data: { metadata: { userId: input.userId } },
    success_url: `${origin}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
  });

  if (!session.url) throw new Error("Stripe-Checkout-Session ohne URL");
  return session.url;
}
