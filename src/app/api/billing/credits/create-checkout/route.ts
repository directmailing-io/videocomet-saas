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
  package: z.enum([
    "credits_50",
    "credits_100",
    "credits_250",
    "credits_500",
    "credits_1000",
    "credits_5000",
  ]),
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

  try {

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
  if (customerId !== row.stripeCustomerId) {
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
    credits_250: prices.credits250,
    credits_500: prices.credits500,
    credits_1000: prices.credits1000,
    credits_5000: prices.credits5000,
  };
  const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
    /\/+$/,
    "",
  );

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceMap[parsed.data.package], quantity: 1 }],
    // MwSt-Handling: Stripe Tax berechnet automatisch je nach Kundenland
    // und USt-ID. Muss im Dashboard aktiviert sein — solange nicht,
    // liefert Stripe 0€ Steuer, was aber trotzdem korrekt ausgewiesen wird.
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    // payment_method_types bewusst nicht gesetzt — Stripe nutzt automatisch
    // alle im Dashboard aktivierten Methoden. SEPA muss dort aktiviert
    // werden (Payment methods → SEPA Direct Debit).
    billing_address_collection: "required",
    // Rechnungspflicht §14 UStG: fuer Top-Ups (One-Time-Payments) muss
    // Stripe automatisch eine Rechnung erzeugen — der Business-Name +
    // USt-IdNr des Betreibers werden im Dashboard hinterlegt und in die
    // PDF eingebrannt.
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: pkg.label,
        metadata: {
          userId: auth.user.id,
          credits: String(pkg.credits),
        },
        // "Rechnungshinweis" — der wird im Footer der PDF gedruckt.
        // Reverse-Charge-Hinweis bei EU-B2B kommt automatisch von
        // Stripe Tax wenn USt-ID gegeben ist.
        footer:
          "Zahlbar sofort nach Erhalt. Fuer Rueckfragen kontaktieren Sie uns bitte.",
        rendering_options: { amount_tax_display: "include_inclusive_tax" },
      },
    },
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
  } catch (err) {
    console.error("[billing:credits:create-checkout]", err);
    return NextResponse.json(
      {
        error:
          "Checkout konnte nicht gestartet werden. Bitte in ein paar Sekunden nochmal versuchen. Wenn es weiterhin nicht klappt, melde dich unter info@videocomet.de.",
      },
      { status: 500 },
    );
  }
}
