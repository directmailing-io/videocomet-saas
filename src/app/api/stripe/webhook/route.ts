export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeWebhookEvents, users } from "@/lib/db/schema";
import { getStripe, mapSubscriptionStatus } from "@/lib/billing/stripe-client";
import { grantTopup } from "@/lib/billing/credit-service";

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
        await handleCheckoutCompleted(event);
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
    const credits = Number(meta.credits ?? 0);
    if (!Number.isFinite(credits) || credits < 1) {
      console.warn(`[stripe:webhook] topup mit ungueltigen credits: ${meta.credits}`);
      return;
    }
    await grantTopup({
      userId,
      amount: credits,
      stripeEventId: event.id,
      stripeRef: session.payment_intent
        ? String(session.payment_intent)
        : session.id,
    });
    return;
  }

  if (kind === "subscription") {
    // Subscription-Objekt aus Session pullen und Status persistieren.
    const subId = session.subscription;
    if (!subId || typeof subId !== "string") return;
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscriptionToUser(userId, sub);
    return;
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
