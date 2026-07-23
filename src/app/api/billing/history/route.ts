export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  campaigns,
  creditTransactions,
  emailBlasts,
  leads,
  runs,
  users,
} from "@/lib/db/schema";

/**
 * GET /api/billing/history?cursor=<id>&limit=<n>&kind=<filter>
 *
 * Volle Credit-History mit Kontext:
 *   - topup: Stripe-Ref
 *   - video_charge: Lead + Run + Kampagne (verlinkt in UI)
 *   - admin_adjust: Admin-Name + Reason
 *
 * Cursor-Pagination auf `credit_transactions.id` (DESC).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 5), 100);
  const cursorRaw = url.searchParams.get("cursor");
  const kindFilter = url.searchParams.get("kind"); // "topup"|"video_charge"|"admin_adjust"|"promo_grant"

  const conds = [eq(creditTransactions.userId, auth.user.id)];
  if (cursorRaw && /^\d+$/.test(cursorRaw)) {
    conds.push(lt(creditTransactions.id, BigInt(cursorRaw)));
  }
  if (
    kindFilter === "topup" ||
    kindFilter === "video_charge" ||
    kindFilter === "admin_adjust" ||
    kindFilter === "promo_grant"
  ) {
    conds.push(eq(creditTransactions.kind, kindFilter));
  } else if (kindFilter === "email") {
    conds.push(
      inArray(creditTransactions.kind, ["email_charge", "email_refund"]),
    );
  }

  // LEFT-JOIN mit runs + campaigns + admin-users, um Kontext direkt
  // mitzuliefern (spart Roundtrips). Falls Lead/Run in der Zwischenzeit
  // geloescht wurden, sind die Felder NULL.
  const rows = await db
    .select({
      id: creditTransactions.id,
      kind: creditTransactions.kind,
      delta: creditTransactions.delta,
      balanceAfter: creditTransactions.balanceAfter,
      reason: creditTransactions.reason,
      stripeRef: creditTransactions.stripeRef,
      createdAt: creditTransactions.createdAt,
      leadId: creditTransactions.leadId,
      runId: creditTransactions.runId,
      leadRowIndex: leads.rowIndex,
      runName: runs.name,
      runCampaignId: runs.campaignId,
      campaignName: campaigns.name,
      adminUserEmail: users.email,
    })
    .from(creditTransactions)
    .leftJoin(leads, eq(leads.id, creditTransactions.leadId))
    .leftJoin(runs, eq(runs.id, creditTransactions.runId))
    .leftJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .leftJoin(
      users,
      and(
        eq(users.id, creditTransactions.adminUserId),
        // Sicherheit: adminUserEmail nur wenn wirklich ein Admin drin steht.
        sql`${creditTransactions.adminUserId} IS NOT NULL`,
      ),
    )
    .where(and(...conds))
    .orderBy(desc(creditTransactions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;

  // E-Mail-Kinds tragen die Blast-ID im Reason ("email_blast:<id>[:suffix]").
  // Kontext (Kampagne + Link) in einem Rutsch nachladen.
  const blastIds = new Set<string>();
  for (const r of rows) {
    if (r.kind === "email_charge" || r.kind === "email_refund") {
      const m = /^email_blast:([^:]+)/.exec(r.reason ?? "");
      if (m) blastIds.add(m[1]!);
    }
  }
  const blastMap = new Map<
    string,
    { campaignId: string; campaignName: string | null }
  >();
  if (blastIds.size > 0) {
    const blastRows = await db
      .select({
        id: emailBlasts.id,
        campaignId: emailBlasts.campaignId,
        campaignName: campaigns.name,
      })
      .from(emailBlasts)
      .leftJoin(campaigns, eq(campaigns.id, emailBlasts.campaignId))
      .where(
        and(
          eq(emailBlasts.userId, auth.user.id),
          inArray(emailBlasts.id, Array.from(blastIds)),
        ),
      );
    for (const b of blastRows) {
      blastMap.set(b.id, {
        campaignId: b.campaignId,
        campaignName: b.campaignName,
      });
    }
  }

  const items = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    kind: r.kind,
    delta: r.delta,
    balanceAfter: r.balanceAfter,
    reason: r.reason,
    stripeRef: r.stripeRef,
    createdAt: r.createdAt.toISOString(),
    // Kontext-Objekt: nur gefuellt bei entsprechenden Kinds.
    context:
      r.kind === "video_charge" && r.runId
        ? {
            leadId: r.leadId,
            leadRowIndex: r.leadRowIndex,
            runId: r.runId,
            runName: r.runName,
            campaignId: r.runCampaignId,
            campaignName: r.campaignName,
          }
        : r.kind === "email_charge" || r.kind === "email_refund"
          ? (() => {
              const m = /^email_blast:([^:]+)/.exec(r.reason ?? "");
              const b = m ? blastMap.get(m[1]!) : undefined;
              return b
                ? {
                    blastId: m![1]!,
                    campaignId: b.campaignId,
                    campaignName: b.campaignName,
                  }
                : null;
            })()
          : r.kind === "admin_adjust"
            ? { adminEmail: r.adminUserEmail }
            : null,
  }));

  return NextResponse.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  });
}
