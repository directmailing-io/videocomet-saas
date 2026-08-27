export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeWebhookEvents, users } from "@/lib/db/schema";
import {
  getStripe,
  getPriceIds,
  mapSubscriptionStatus,
  CREDIT_PACKAGES,
} from "@/lib/billing/stripe-client";
import { grantTopup, grantWelcomeCredits } from "@/lib/billing/credit-service";
import {
  sendSubscriptionStartedMail,
  sendTopupConfirmationMail,
} from "@/lib/mail";
import { trackSystemPurchaseEvent } from "@/lib/meta/track-server";

/**
 * POST /api/stripe/webhook
 *
 * Empfaengt Stripe-Events. Reihenfolge:
 *   1. Signatur verifizieren (STRIPE_WEBHOOK_SECRET).
 *   2. INSERT INTO stripe_webhook_events (id PRIMARY KEY) — Idempotenz-Gate.
 *      Duplicate-Event → sofort 200.
 *   3. Event verarbeiten je nach Type.
 *   4. Bei Erfolg: UPDATE processed_at.
 *   5. Bei Fehler: KEIN processed_at → Stripe retry'd.
 *
 * Rueckgabe muss IMMER 2xx sein wenn wir das Event akzeptieren, sonst
 * retry'd Stripe stundenlang. Nur bei Signatur-Fail geben wir 400.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json(
      { error: "Missing signature or webhook secret" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[stripe:webhook] signature-verify failed:", err);
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  // Idempotenz-Gate: versuche Event zu INSERT'en, bei Duplicate ignore.
  try {
    await db.insert(stripeWebhookEvents).values({
      id: event.id,
      type: event.type,
      payload: event as unknown,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      // Duplicate — Event wurde schon empfangen. Wir pruefen ob processed.
      const [existing] = await db
        .select({ processedAt: stripeWebhookEvents.processedAt })
        .from(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.id, event.id))
        .limit(1);
      if (existing?.processedAt) {
        // Schon fertig verarbeitet — Stripe darf aufhoeren zu retry'n.
        return NextResponse.json({ received: true, deduped: true });
      }
      // Sonst: der Handler ist gerade in Progress oder ist vorher gecrasht.
      // Wir versuchen nochmal — beim naechsten Retry.
    } else {
      console.error("[stripe:webhook] event insert failed:", err);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }

  // Handler-Dispatch.
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event);
        break;
      case "checkout.session.async_payment_failed":
        await handleAsyncPaymentFailed(event);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event);
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        await handleInvoice(event);
        break;
      default:
        // Unbekannte Events akzeptieren (200) aber nicht verarbeiten.
        break;
    }
    await db
      .update(stripeWebhookEvents)
      .set({ processedAt: new Date(), errorMessage: null })
      .where(eq(stripeWebhookEvents.id, event.id));
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`[stripe:webhook] handler failed for ${event.type}:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(stripeWebhookEvents)
      .set({ errorMessage: msg })
      .where(eq(stripeWebhookEvents.id, event.id));
    // 500 damit Stripe retry'd — aber nur bei echten Fehlern, nicht bei
    // legit-not-applicable Events (die gehen oben in default).
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}

/**
 * checkout.session.completed — deckt sowohl Subscription-Erst-Setup als
 * auch Top-Up-One-Time-Payment ab (unterscheiden via `mode` bzw. metadata).
 */
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const userId = meta.userId;
  const kind = meta.kind;
  if (!userId) {
    console.warn(`[stripe:webhook] checkout.session ohne userId in metadata: ${session.id}`);
    return;
  }

  if (kind === "topup") {
    // SEPA & Co. sind asynchron: checkout.session.completed feuert dann mit
    // payment_status="unpaid" BEVOR das Geld da ist. Credits gibt es erst,
    // wenn die Zahlung wirklich durch ist — bei async Methoden via
    // checkout.session.async_payment_succeeded (payment_status="paid").
    if (session.payment_status !== "paid") {
      console.log(
        `[stripe:webhook] topup ${session.id} noch nicht bezahlt (${session.payment_status}) — warte auf async_payment_succeeded`,
      );
      return;
    }
    const credits = Number(meta.credits ?? 0);
    if (!Number.isFinite(credits) || credits < 1) {
      console.warn(`[stripe:webhook] topup mit ungueltigen credits: ${meta.credits}`);
      return;
    }
    const txRow = await grantTopup({
      userId,
      amount: credits,
      stripeEventId: event.id,
      stripeRef: session.payment_intent
        ? String(session.payment_intent)
        : session.id,
    });
    // Bestaetigungsmail nur bei echter Erst-Gutschrift (txRow === null ist
    // ein Webhook-Replay). Best-effort: Mail-Fehler darf den Webhook nicht
    // failen lassen, sonst retry't Stripe und wir loggen Fehler doppelt.
    if (txRow) {
      const pkg = CREDIT_PACKAGES.find((p) => p.id === meta.packageId);
      await sendMailBestEffort("topup-confirmation", userId, (user) =>
        sendTopupConfirmationMail({
          to: user.email,
          firstName: user.firstName,
          packageLabel: pkg?.label ?? `${credits} Credits`,
          credits,
          newBalance: txRow.balanceAfter,
        }),
      );
      // Meta CAPI: Purchase-Event mit dem realen €-Wert aus der Session.
      // `event_id = stripeEventId` — global eindeutig, dedupliziert bei
      // Stripe-Replays. amount_total ist in Cent → durch 100.
      const [userRow] = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const valueEur = Number(((session.amount_total ?? 0) / 100).toFixed(2));
      void trackSystemPurchaseEvent({
        eventName: "Purchase",
        eventId: `stripe_${event.id}`,
        eventSourceUrl: "https://videocomet.de/signup/success",
        userData: {
          email: userRow?.email ?? null,
          firstName: userRow?.firstName ?? null,
          lastName: userRow?.lastName ?? null,
          externalId: userId,
          country: "de",
        },
        customData: {
          value: valueEur,
          currency: (session.currency ?? "eur").toUpperCase(),
          content_name: meta.packageId ?? `${credits} Credits`,
          content_ids: [meta.packageId ?? "unknown"],
          credits_purchased: credits,
        },
      });
    }
    return;
  }

  if (kind === "subscription") {
    // Subscription-Objekt aus Session pullen und Status persistieren.
    const subId = session.subscription;
    if (!subId || typeof subId !== "string") return;
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscriptionToUser(userId, sub);
    // Willkommensmail genau einmal: bei Karte feuert completed direkt mit
    // payment_status="paid"; bei async Methoden (SEPA) kommt completed mit
    // "unpaid" (keine Mail) und spaeter async_payment_succeeded mit "paid".
    if (
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required"
    ) {
      // Startquartal-Mechanik: Phase 1 = 120 € / 3 Monate (bereits bezahlt),
      // Phase 2 = 40 € monatlich. Muss VOR processed_at laufen — wirft bei
      // Fehler, damit Stripe retry't und kein Abo im Quartals-Preis haengt.
      await ensureStartquartalSchedule(sub);

      // 20 Credits Startguthaben — genau einmal pro User (idempotent).
      const welcomeTx = await grantWelcomeCredits({
        userId,
        amount: 20,
        stripeRef: sub.id,
      });
      if (welcomeTx) {
        console.log(
          `[stripe:webhook] Startguthaben 20 Credits fuer user ${userId} gutgeschrieben (balance ${welcomeTx.balanceAfter})`,
        );
      }

      await sendMailBestEffort("subscription-started", userId, (user) =>
        sendSubscriptionStartedMail({
          to: user.email,
          firstName: user.firstName,
        }),
      );
      // Meta CAPI: Subscribe-Event mit erwartetem Jahres-LTV (Meta empfiehlt
      // Jahres-Wert statt Monatspreis, sonst optimiert der Algorithmus auf
      // Billigst-Käufer). Wir nutzen `amount_total` × 3 als Näherung für das
      // 3-Monats-Startpaket → x4 pro Jahr = 12 Monate.
      const [userRow] = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const monthlyEur = ((session.amount_total ?? 0) / 100) / 3;
      const yearlyLtv = Number((monthlyEur * 12).toFixed(2));
      void trackSystemPurchaseEvent({
        eventName: "Subscribe",
        eventId: `stripe_${event.id}`,
        eventSourceUrl: "https://videocomet.de/signup/success",
        userData: {
          email: userRow?.email ?? null,
          firstName: userRow?.firstName ?? null,
          lastName: userRow?.lastName ?? null,
          externalId: userId,
          country: "de",
        },
        customData: {
          value: yearlyLtv,
          currency: (session.currency ?? "eur").toUpperCase(),
          content_name: "subscription_retainer",
          predicted_ltv: yearlyLtv,
        },
      });
    }
    return;
  }
}

async function sendMailBestEffort(
  label: string,
  userId: string,
  send: (user: { email: string; firstName: string | null }) => Promise<void>,
): Promise<void> {
  try {
    const [user] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      console.warn(`[stripe:webhook] ${label} mail: user ${userId} not found`);
      return;
    }
    await send(user);
  } catch (err) {
    console.error(`[stripe:webhook] ${label} mail failed for user ${userId}:`, err);
  }
}

/**
 * checkout.session.async_payment_failed — die asynchrone Zahlung (z. B.
 * SEPA) ist endgueltig fehlgeschlagen.
 *
 * Topup: Credits wurden nie gutgeschrieben (Guard oben), also nur loggen.
 * Subscription: Status aus Stripe nachziehen, damit das Access-Gate den
 * fehlgeschlagenen Zustand (incomplete/past_due) korrekt widerspiegelt.
 */
async function handleAsyncPaymentFailed(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const userId = meta.userId;

  if (meta.kind === "topup") {
    console.warn(
      `[stripe:webhook] async payment failed fuer topup ${session.id} (user ${userId ?? "?"}) — keine Credits vergeben, nichts zu tun`,
    );
    return;
  }

  if (meta.kind === "subscription" && userId) {
    const subId = session.subscription;
    if (!subId || typeof subId !== "string") return;
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscriptionToUser(userId, sub);
  }
}

/**
 * customer.subscription.{created,updated,deleted}
 *
 * Bei `deleted` setzen wir stripeSubscriptionId zurueck auf NULL — der
 * User kann dann einen sauberen neuen Checkout auf dem SELBEN
 * stripeCustomerId starten (Customer bleibt erhalten fuer Historie +
 * Rechnungen). Ohne das Reset wuerde ein Reaktivierungs-Versuch versuchen,
 * die geloeschte Subscription-ID zu reaktivieren, was fehlschlaegt.
 */
async function handleSubscriptionChange(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const userId = sub.metadata?.userId;
  if (!userId) return;

  if (event.type === "customer.subscription.deleted") {
    // Cleanup nach endgueltiger Loeschung.
    await db
      .update(users)
      .set({
        subscriptionStatus: "canceled",
        stripeSubscriptionId: null, // Reset, damit Reaktivierung sauberen Checkout macht
        // stripeCustomerId behalten — Rechnungshistorie bleibt zugreifbar
        subscriptionCurrentPeriodEnd: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    return;
  }

  await syncSubscriptionToUser(userId, sub);
}

async function syncSubscriptionToUser(userId: string, sub: Stripe.Subscription) {
  const status = mapSubscriptionStatus(sub.status);
  // Ab Stripe API 2026-06 sitzt current_period_end auf den Subscription-Items,
  // nicht mehr auf der Subscription selbst. Wir nehmen den frühesten Wert.
  const items = sub.items?.data ?? [];
  let earliestEnd: number | null = null;
  for (const it of items) {
    const end = (it as unknown as { current_period_end?: number }).current_period_end;
    if (typeof end === "number") {
      if (earliestEnd == null || end < earliestEnd) earliestEnd = end;
    }
  }
  await db
    .update(users)
    .set({
      subscriptionStatus: status,
      stripeSubscriptionId: sub.id,
      subscriptionCurrentPeriodEnd: earliestEnd
        ? new Date(earliestEnd * 1000)
        : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Startquartal: Die Checkout-Session laeuft auf dem Quartals-Preis
 * (120 € / 3 Monate). Damit die Subscription danach NICHT quartalsweise
 * weiterlaeuft, haengen wir eine Subscription-Schedule dran:
 *   Phase 1: aktueller Quartals-Preis bis zum Ende der bezahlten Periode
 *   Phase 2: 40 € monatlich (1 Iteration), danach `release` —
 *            die Subscription laeuft als normales Monats-Abo weiter,
 *            monatlich kuendbar ueber das Customer-Portal.
 *
 * Idempotent: hat die Subscription schon eine Schedule (Webhook-Replay),
 * passiert nichts. Bestandskunden sind nicht betroffen — diese Funktion
 * laeuft nur im Checkout-Completed-Pfad neuer Abschluesse.
 */
async function ensureStartquartalSchedule(sub: Stripe.Subscription) {
  if (sub.schedule) return;
  const stripe = getStripe();
  const monthlyPrice = getPriceIds().subscriptionMonthly;

  const schedule = await stripe.subscriptionSchedules.create({
    from_subscription: sub.id,
  });
  const phase0 = schedule.phases[0];
  if (!phase0) {
    throw new Error(`Schedule ${schedule.id} ohne Phase — unerwartet`);
  }
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        items: phase0.items.map((it) => ({
          price: typeof it.price === "string" ? it.price : it.price.id,
          quantity: it.quantity ?? 1,
        })),
        start_date: phase0.start_date,
        end_date: phase0.end_date,
        automatic_tax: { enabled: true },
      },
      {
        items: [{ price: monthlyPrice, quantity: 1 }],
        duration: { interval: "month", interval_count: 1 },
        automatic_tax: { enabled: true },
      },
    ],
  });
  console.log(
    `[stripe:webhook] Startquartal-Schedule ${schedule.id} fuer sub ${sub.id} angelegt (danach 40 € monatlich)`,
  );
}

/**
 * invoice.paid / invoice.payment_failed — Status-Update aus dem
 * Subscription-Objekt (Stripe hat da die Wahrheit).
 */
async function handleInvoice(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  // In neueren API-Versionen ist invoice.subscription entweder direkt oder
  // via parent.subscription_details erreichbar — wir prüfen defensiv beide.
  const subIdRaw =
    (invoice as unknown as { subscription?: string | Stripe.Subscription | null })
      .subscription ??
    (invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string } };
    }).parent?.subscription_details?.subscription;
  const subId = typeof subIdRaw === "string" ? subIdRaw : subIdRaw?.id ?? null;
  if (!subId) return;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subId);
  const userId = sub.metadata?.userId;
  if (!userId) return;
  await syncSubscriptionToUser(userId, sub);
}
