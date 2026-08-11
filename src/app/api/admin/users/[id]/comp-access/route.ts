export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/users/[id]/comp-access
 *   Body: { months: number (0.5 - 60), reason: string }
 *   Setzt subscription_status='active' + subscription_current_period_end = NOW + months.
 *   Nur zulässig, wenn der User KEINE aktive Stripe-Subscription hat — sonst
 *   würde der nächste Stripe-Webhook den Status überschreiben.
 *
 * DELETE /api/admin/users/[id]/comp-access
 *   Hebt einen Gratis-Zugang wieder auf (subscription_status → NULL,
 *   subscription_current_period_end → NULL). Blockt ebenfalls, wenn eine
 *   Stripe-Subscription verknüpft ist, damit ein zahlender Kunde nicht
 *   versehentlich gesperrt wird.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getUserById } from "@/lib/db/queries/users";

const GRANT_BODY = z.object({
  months: z.number().refine((v) => v >= 0.5 && v <= 60, "months 0.5–60"),
  reason: z.string().trim().min(3, "Grund ist Pflicht (min 3 Zeichen)").max(500),
});

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof GRANT_BODY>;
  try {
    body = GRANT_BODY.parse(await req.json());
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Ungültige Anfrage.")
        : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let target;
  try {
    target = await getUserById(ctx.params.id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  if (target.stripeSubscriptionId) {
    return NextResponse.json(
      {
        error:
          "User hat eine aktive Stripe-Subscription. Bitte erst in Stripe kündigen oder pausieren, sonst überschreibt der nächste Webhook den Gratis-Zugang.",
      },
      { status: 409 },
    );
  }

  const periodEnd = new Date();
  periodEnd.setTime(periodEnd.getTime() + body.months * 30 * 24 * 60 * 60 * 1000);

  const [updated] = await db
    .update(users)
    .set({
      subscriptionStatus: "active",
      subscriptionCurrentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(users.id, ctx.params.id))
    .returning({
      id: users.id,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
    });

  console.log(
    `[admin:comp-access:grant] admin=${guard.user.id} target=${ctx.params.id} months=${body.months} reason=${JSON.stringify(body.reason)}`,
  );

  return NextResponse.json({
    ok: true,
    subscriptionStatus: updated.subscriptionStatus,
    subscriptionCurrentPeriodEnd: updated.subscriptionCurrentPeriodEnd,
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let target;
  try {
    target = await getUserById(ctx.params.id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  if (target.stripeSubscriptionId) {
    return NextResponse.json(
      {
        error:
          "User hat eine aktive Stripe-Subscription. Ein Sperren würde einen zahlenden Kunden aussperren — bitte in Stripe kündigen.",
      },
      { status: 409 },
    );
  }

  await db
    .update(users)
    .set({
      subscriptionStatus: null,
      subscriptionCurrentPeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, ctx.params.id));

  console.log(
    `[admin:comp-access:revoke] admin=${guard.user.id} target=${ctx.params.id}`,
  );

  return NextResponse.json({ ok: true });
}
