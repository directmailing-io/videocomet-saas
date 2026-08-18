export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, emailVerifications } from "@/lib/db/schema";
import { createSignupCheckout, marketingOrigin } from "@/lib/billing/signup-checkout";
import { trackServerBrowserEvent } from "@/lib/meta/track-server";

/**
 * GET /api/auth/verify-email?token=...
 *
 * Bestaetigungslink aus der Signup-Mail. Setzt users.emailVerifiedAt und
 * leitet DIREKT in den Stripe-Checkout weiter (kein Zwischenschritt).
 *
 * Gueltiger-aber-schon-benutzter Token innerhalb der 24h leitet ebenfalls
 * weiter (Doppelklick / Mail-Scanner-Vorabklick sollen den User nicht auf
 * einer Fehlerseite stranden lassen). Bei bereits aktivem Abo → App-Login.
 */
export async function GET(req: NextRequest) {
  const origin = marketingOrigin();
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token.length < 16) {
    return NextResponse.redirect(`${origin}/signup?verify=invalid`);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select({
      id: emailVerifications.id,
      userId: emailVerifications.userId,
      expiresAt: emailVerifications.expiresAt,
      usedAt: emailVerifications.usedAt,
    })
    .from(emailVerifications)
    .where(eq(emailVerifications.tokenHash, tokenHash))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!row) {
    return NextResponse.redirect(`${origin}/signup?verify=invalid`);
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(`${origin}/signup?verify=expired`);
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      companyName: users.companyName,
      vatId: users.vatId,
      stripeCustomerId: users.stripeCustomerId,
      subscriptionStatus: users.subscriptionStatus,
      emailVerifiedAt: users.emailVerifiedAt,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return NextResponse.redirect(`${origin}/signup?verify=invalid`);
  }

  if (!row.usedAt) {
    await db
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(eq(emailVerifications.id, row.id));
  }
  const isFirstVerification = !user.emailVerifiedAt;
  if (isFirstVerification) {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    // Meta CAPI: Konto verifiziert → CompleteRegistration.
    void trackServerBrowserEvent({
      req,
      eventName: "CompleteRegistration",
      userData: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        externalId: user.id,
        country: "de",
      },
      customData: { status: true },
    });
  }

  // Abo laeuft schon (z. B. Link spaeter nochmal geklickt) → in die App.
  if (
    user.subscriptionStatus === "active" ||
    user.subscriptionStatus === "trialing"
  ) {
    const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(/\/+$/, "");
    return NextResponse.redirect(`${appOrigin}/login`);
  }

  try {
    const url = await createSignupCheckout({
      userId: user.id,
      email: user.email,
      name:
        user.companyName ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        null,
      vatId: user.vatId ?? null,
      existingCustomerId: user.stripeCustomerId ?? null,
    });
    // Meta CAPI: gleich vor dem Stripe-Redirect InitiateCheckout feuern.
    void trackServerBrowserEvent({
      req,
      eventName: "InitiateCheckout",
      userData: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        externalId: user.id,
        country: "de",
      },
      customData: { content_name: "subscription_signup" },
    });
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[verify-email] Checkout-Fehler:", err);
    return NextResponse.redirect(`${origin}/signup?verify=checkout_error`);
  }
}
