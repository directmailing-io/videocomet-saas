export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";

/**
 * GET /api/billing/invoices?limit=<n>&starting_after=<id>
 *
 * Listet alle Rechnungen des Users direkt aus Stripe — sowohl automatisch
 * fuer Subscription-Renewals als auch fuer Top-Up-One-Time-Payments
 * (invoice_creation.enabled=true).
 *
 * Jede Rechnung enthaelt:
 *   - Betrag netto + Steuer + brutto
 *   - Status (paid/open/void/uncollectible)
 *   - Hosted-URL zum Ansehen im Browser
 *   - PDF-URL fuer Download
 *   - Line-Items (was war drin: "Plattform-Zugang" / "100 Credits")
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);

  if (!row?.stripeCustomerId) {
    return NextResponse.json({ items: [], nextCursor: null });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 12), 5), 50);
  const startingAfter = url.searchParams.get("starting_after") ?? undefined;

  const stripe = getStripe();
  const list = await stripe.invoices.list({
    customer: row.stripeCustomerId,
    limit,
    starting_after: startingAfter,
  });

  const items = list.data.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
    dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
    subtotal: inv.subtotal, // in cents, netto
    // Ab neuerer Stripe-API-Version ist tax auf total_taxes[] verteilt.
    // Wir summieren defensiv beide Formen.
    tax:
      (inv as unknown as { tax?: number | null }).tax ??
      ((inv as unknown as { total_taxes?: Array<{ amount?: number }> })
        .total_taxes ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0),
    total: inv.total,
    currency: inv.currency,
    hostedInvoiceUrl: inv.hosted_invoice_url,
    invoicePdf: inv.invoice_pdf,
    // Line-Items komprimiert: nur Beschreibung + Betrag.
    lines: (inv.lines?.data ?? []).map((l) => ({
      description: l.description ?? "",
      amount: l.amount,
      quantity: l.quantity ?? 1,
    })),
  }));

  return NextResponse.json({
    items,
    nextCursor: list.has_more ? items[items.length - 1]?.id ?? null : null,
  });
}
