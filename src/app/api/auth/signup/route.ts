export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createUser } from "@/lib/db/queries/users";
import { findOrCreateCustomer, getPriceIds, getStripe } from "@/lib/billing/stripe-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * POST /api/auth/signup
 *
 * B2B-only Self-Service-Signup:
 *   1. Rate-Limit (3/h/IP) + Turnstile-Verify (Bot-Schutz)
 *   2. Validation (Password ≥12 chars, Groß/Klein/Ziffer)
 *   3. Duplicate-Check: bei aktivem Account → generische "reset PW"-Antwort;
 *      bei existierendem-aber-nicht-bezahltem Account → reuse
 *   4. User anlegen (subscriptionStatus = null bis Payment durch)
 *   5. Stripe-Customer + Checkout-Session mit userId in metadata
 *   6. Return: Stripe-Checkout-URL zum Redirect
 *
 * B2B-only: Firmenname ist Pflicht, USt-ID optional aber empfohlen. AGB
 * + Datenschutz-Zustimmung ueber explizite Checkbox (Body-Flag).
 */

const PASSWORD_MIN = 12;
const PASSWORD_SCHEMA = z
  .string()
  .min(PASSWORD_MIN, `Mindestens ${PASSWORD_MIN} Zeichen`)
  .regex(/[A-Z]/, "Mindestens 1 Großbuchstabe")
  .regex(/[a-z]/, "Mindestens 1 Kleinbuchstabe")
  .regex(/[0-9]/, "Mindestens 1 Ziffer");

const BODY = z.object({
  email: z.string().trim().toLowerCase().email("Ungültige Email"),
  password: PASSWORD_SCHEMA,
  firstName: z.string().trim().min(1, "Vorname fehlt").max(80),
  lastName: z.string().trim().min(1, "Nachname fehlt").max(80),
  companyName: z
    .string()
    .trim()
    .min(2, "Firmenname fehlt (B2B-Pflicht)")
    .max(200),
  vatId: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => (v && v.length > 0 ? v.toUpperCase() : undefined)),
  acceptTerms: z.literal(true, {
    message: "AGB müssen akzeptiert werden",
  }),
  turnstileToken: z.string().min(1, "Bot-Schutz-Token fehlt"),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  // 1) Rate-Limit
  const ip = clientIp(req);
  const rl = await checkRateLimit(`signup:${ip}`, 3, 60 * 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Zu viele Signup-Versuche. Bitte in einer Stunde erneut probieren." },
      { status: 429 },
    );
  }

  // 2) Body-Validation
  const raw = await req.json().catch(() => null);
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  // 3) Turnstile-Verify (Bot-Schutz)
  const captchaOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!captchaOk) {
    return NextResponse.json(
      { error: "Bot-Schutz-Prüfung fehlgeschlagen. Bitte Seite neu laden." },
      { status: 400 },
    );
  }

  const { email, password, firstName, lastName, companyName, vatId } = parsed.data;

  // 4) Duplicate-Check — Email-Enumeration-safe:
  //    - Existiert User + aktive Subscription → generische Fehlermeldung
  //    - Existiert User + KEINE aktive Subscription → reuse (neuer Checkout)
  const [existing] = await db
    .select({
      id: users.id,
      subscriptionStatus: users.subscriptionStatus,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  let stripeCustomerId: string | null;

  if (existing) {
    // Falls User schon aktiv → 409 mit generischer Message (keine
    // Enumeration ob User existiert).
    if (
      existing.subscriptionStatus === "active" ||
      existing.subscriptionStatus === "trialing"
    ) {
      return NextResponse.json(
        {
          error:
            "Konto existiert bereits. Bitte einloggen oder Passwort zurücksetzen.",
          errorKind: "existing_active",
        },
        { status: 409 },
      );
    }
    // Sonst: existiert aber Zahlung nicht erfolgreich — wir reusen und
    // starten neuen Checkout. Passwort NICHT ueberschreiben (Security:
    // sonst koennte jemand fremde Emails übernehmen).
    userId = existing.id;
    stripeCustomerId = existing.stripeCustomerId;
  } else {
    // Neuer User
    const created = await createUser({
      email,
      password,
      role: "user",
      isActive: true,
      firstName,
      lastName,
      companyName,
      vatId: vatId ?? undefined,
    });
    userId = created.id;
    stripeCustomerId = null;
  }

  // 5) Stripe-Customer + Checkout-Session
  const customerId = await findOrCreateCustomer({
    userId,
    email,
    name: companyName || `${firstName} ${lastName}`.trim(),
    vatId: vatId ?? null,
    existingCustomerId: stripeCustomerId,
  });
  if (!stripeCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(users.id, userId));
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
    payment_method_types: ["card", "sepa_debit"],
    billing_address_collection: "required",
    metadata: { userId, kind: "subscription" },
    subscription_data: { metadata: { userId } },
    success_url: `${appOrigin}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appOrigin}/#pricing`,
  });

  return NextResponse.json({ url: session.url }, { status: 200 });
}
