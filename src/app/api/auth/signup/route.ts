export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, emailVerifications } from "@/lib/db/schema";
import { createUser } from "@/lib/db/queries/users";
import { createSignupCheckout, marketingOrigin } from "@/lib/billing/signup-checkout";
import { sendEmailVerificationMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * POST /api/auth/signup
 *
 * B2B-only Self-Service-Signup:
 *   1. Rate-Limit (3/h/IP) + Turnstile-Verify (Bot-Schutz)
 *   2. Validation (Password ≥8 chars)
 *   3. Duplicate-Check: bei aktivem Account → generische "reset PW"-Antwort;
 *      bei existierendem-aber-nicht-bezahltem Account → reuse
 *   4. User anlegen (subscriptionStatus = null bis Payment durch)
 *   5. E-Mail unbestaetigt → Verifizierungsmail + { verificationRequired } —
 *      der Link verifiziert und leitet direkt in den Stripe-Checkout
 *   6. E-Mail bestaetigt → Stripe-Customer + Checkout-Session, Return: URL
 *
 * B2B-only: Firmenname ist Pflicht, USt-ID optional aber empfohlen. AGB
 * + Datenschutz-Zustimmung ueber explizite Checkbox (Body-Flag).
 */

const PASSWORD_MIN = 8;
const PASSWORD_SCHEMA = z
  .string()
  .min(PASSWORD_MIN, `Mindestens ${PASSWORD_MIN} Zeichen`);

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
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  let stripeCustomerId: string | null;
  let emailVerified: boolean;

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
    emailVerified = existing.emailVerifiedAt != null;
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
    emailVerified = false;
  }

  // 5) E-Mail noch nicht bestaetigt → Verifizierungsmail statt Checkout.
  //    Der Link im Postfach verifiziert und leitet direkt zu Stripe weiter.
  if (!emailVerified) {
    try {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.insert(emailVerifications).values({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await sendEmailVerificationMail({
        to: email,
        firstName,
        verifyUrl: `${marketingOrigin()}/api/auth/verify-email?token=${token}`,
      });
      return NextResponse.json({ verificationRequired: true }, { status: 200 });
    } catch (err) {
      console.error("[signup] Verifizierungsmail-Fehler:", err);
      return NextResponse.json(
        {
          error:
            "Die Bestätigungsmail konnte nicht gesendet werden. Bitte versuch es gleich nochmal oder schreib an info@videocomet.de.",
        },
        { status: 500 },
      );
    }
  }

  // 6) E-Mail bereits bestaetigt (z. B. zweiter Anlauf nach abgebrochenem
  //    Checkout) → direkt Stripe-Customer + Checkout-Session.
  try {
    const url = await createSignupCheckout({
      userId,
      email,
      name: companyName || `${firstName} ${lastName}`.trim(),
      vatId: vatId ?? null,
      existingCustomerId: stripeCustomerId,
    });
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    console.error("[signup] Stripe/Checkout-Fehler:", err);
    return NextResponse.json(
      {
        error:
          "Die Bestellung konnte nicht gestartet werden. Bitte versuch es gleich nochmal oder schreib an info@videocomet.de.",
      },
      { status: 500 },
    );
  }
}
