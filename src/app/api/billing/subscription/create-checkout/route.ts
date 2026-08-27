export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  findOrCreateCustomer,
  getPriceIds,
  getStripe,
} from "@/lib/billing/stripe-client";

/**
 * POST /api/billing/subscription/create-checkout
 *
 * Erstellt eine Stripe-Checkout-Session fuer die Plattform-Subscription (Startquartal 120 €, danach 40 € monatlich via Schedule im Webhook).
 * Redirect-URL wird zurueckgegeben — Client leitet direkt zu Stripe weiter.
 *
 * Bereits aktive Subscription → 409 Conflict.
 */
export async function POST() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const [row] = await db
      .select({
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        companyName: users.companyName,
        vatId: users.vatId,
        stripeCustomerId: users.stripeCustomerId,
        subscriptionStatus: users.subscriptionStatus,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);

    if (!row) return NextResponse.json({ error: "User nicht gefunden" }, { status: 404 });

    if (!row.emailVerifiedAt) {
      return NextResponse.json(
        { error: "Bitte bestätige zuerst deine E-Mail-Adresse. Schau in dein Postfach." },
        { status: 403 },
      );
    }

    if (row.subscriptionStatus === "active" || row.subscriptionStatus === "trialing") {
      return NextResponse.json(
        { error: "Subscription bereits aktiv." },
        { status: 409 },
      );
    }

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

    // Persist ID falls neu ODER falls die alte ID im aktuellen Stripe-Account
    // nicht mehr existierte und findOrCreateCustomer eine neue erzeugt hat.
    if (customerId !== row.stripeCustomerId) {
      await db
        .update(users)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(and(eq(users.id, auth.user.id)));
    }

    const stripe = getStripe();
    const { subscription: subPriceId } = getPriceIds();
    const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
      /\/+$/,
      "",
    );

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: subPriceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: true },
      // payment_method_types bewusst nicht gesetzt — Stripe nutzt automatisch
      // alle im Dashboard aktivierten Methoden (mind. Card). SEPA muss dort
      // explizit aktiviert werden (Payment methods → SEPA Direct Debit),
      // sobald das passiert ist es hier automatisch verfuegbar.
      billing_address_collection: "required",
      metadata: { userId: auth.user.id, kind: "subscription" },
      subscription_data: {
        metadata: { userId: auth.user.id },
      },
      success_url: `${appOrigin}/einstellungen?tab=abrechnung&sub=success`,
      cancel_url: `${appOrigin}/einstellungen?tab=abrechnung&sub=cancel`,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("[billing:subscription:create-checkout]", err);
    return NextResponse.json(
      {
        error:
          "Checkout konnte nicht gestartet werden. Bitte in ein paar Sekunden nochmal versuchen. Wenn es weiterhin nicht klappt, melde dich unter info@videocomet.de.",
      },
      { status: 500 },
    );
  }
}
