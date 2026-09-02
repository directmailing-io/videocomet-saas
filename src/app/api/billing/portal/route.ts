export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";

/**
 * POST /api/billing/portal
 *
 * Erstellt eine Stripe-Customer-Portal-Session. Der Portal ist ein
 * Stripe-gehosteter Bereich wo der User Subscription verwalten, Zahlung
 * aktualisieren und Rechnungen einsehen kann. Wir muessen im
 * Stripe-Dashboard vorher das Portal einmalig konfigurieren
 * (dashboard.stripe.com/test/settings/billing/portal).
 */
export async function POST() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);

  if (!row?.stripeCustomerId) {
    return NextResponse.json(
      { error: "Noch kein Stripe-Kunde. Bitte erst Subscription abschliessen." },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
    /\/+$/,
    "",
  );
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${appOrigin}/einstellungen?tab=abrechnung`,
  });

  return NextResponse.json(
    { url: session.url },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
