/**
 * Stripe-Client-Singleton mit strengem Env-Check.
 *
 * Wir instanziieren den Client lazy — Import in Client-Bundles wird
 * dadurch nicht das Stripe-SDK mitziehen. Alle Aufrufer verwenden
 * `getStripe()`.
 */

import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY nicht gesetzt");
  }
  // Kein apiVersion setzen — Stripe nutzt die zum SDK passende Version
  // aus package.json ("latestApiVersion"), das bleibt beim Upgrade
  // konsistent.
  cached = new Stripe(key, { typescript: true });
  return cached;
}

/**
 * Preise + Produkt-IDs aus Env — im Setup-Script haben wir sie erstellt.
 * Wir zentralisieren hier den Lookup, damit Routen kompakt bleiben.
 */
export function getPriceIds(): {
  subscription: string;
  credits50: string;
  credits100: string;
  credits500: string;
} {
  const sub = process.env.STRIPE_PRICE_SUBSCRIPTION;
  const c50 = process.env.STRIPE_PRICE_CREDITS_50;
  const c100 = process.env.STRIPE_PRICE_CREDITS_100;
  const c500 = process.env.STRIPE_PRICE_CREDITS_500;
  if (!sub || !c50 || !c100 || !c500) {
    throw new Error(
      "Stripe-Price-Env unvollstaendig — STRIPE_PRICE_SUBSCRIPTION/CREDITS_50/CREDITS_100/CREDITS_500 pruefen",
    );
  }
  return { subscription: sub, credits50: c50, credits100: c100, credits500: c500 };
}

/** Wieviele Credits geben wir pro Top-Up-Paket. Mengen-Rabatte in Preis eingebaut. */
export const CREDIT_PACKAGES: ReadonlyArray<{
  id: "credits_50" | "credits_100" | "credits_500";
  credits: number;
  amountCents: number; // netto
  label: string;
}> = [
  { id: "credits_50", credits: 50, amountCents: 5000, label: "50 Credits" },
  { id: "credits_100", credits: 100, amountCents: 9500, label: "100 Credits (5% Rabatt)" },
  { id: "credits_500", credits: 500, amountCents: 42500, label: "500 Credits (15% Rabatt)" },
];

/**
 * Findet oder erzeugt einen Stripe-Customer fuer den User. Speichert die
 * ID auf users.stripeCustomerId beim ersten Checkout.
 */
export async function findOrCreateCustomer(input: {
  userId: string;
  email: string;
  name?: string | null;
  vatId?: string | null;
  existingCustomerId?: string | null;
}): Promise<string> {
  if (input.existingCustomerId) return input.existingCustomerId;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: input.email,
    name: input.name ?? undefined,
    metadata: {
      userId: input.userId,
      vatId: input.vatId ?? "",
    },
  });
  return customer.id;
}

/**
 * Mapping: Stripe-Subscription-Status → unser DB-Enum. Stripe hat mehr
 * Status-Werte als wir (z.B. `paused`), wir nehmen die naechste sinnvolle
 * Abbildung.
 */
export function mapSubscriptionStatus(
  s: Stripe.Subscription.Status,
): "active" | "past_due" | "canceled" | "incomplete" | "trialing" | "unpaid" {
  switch (s) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "unpaid":
      return s;
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}
