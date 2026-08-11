import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getUserById } from "@/lib/db/queries/users";
import { db } from "@/lib/db";
import { campaigns, runs, mediaItems } from "@/lib/db/schema";
import { listTransactions } from "@/lib/billing/credit-service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { UserDetailClient } from "./user-detail-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
  searchParams?: { tab?: string };
}

async function getActivityStats(userId: string) {
  try {
    const [campaignsRow, runsRow, mediaRow] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaigns)
        .where(eq(campaigns.userId, userId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.userId, userId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(mediaItems)
        .where(eq(mediaItems.userId, userId)),
    ]);
    return {
      campaigns: campaignsRow[0]?.count ?? 0,
      runs: runsRow[0]?.count ?? 0,
      media: mediaRow[0]?.count ?? 0,
    };
  } catch {
    return { campaigns: 0, runs: 0, media: 0 };
  }
}

async function getCampaignsWithRuns(userId: string) {
  const [campaignRows, runRows] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .where(eq(campaigns.userId, userId))
      .orderBy(desc(campaigns.createdAt)),
    db
      .select({
        id: runs.id,
        campaignId: runs.campaignId,
        name: runs.name,
        status: runs.status,
        totalLeads: runs.totalLeads,
        completedLeads: runs.completedLeads,
        failedLeads: runs.failedLeads,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .where(eq(runs.userId, userId))
      .orderBy(desc(runs.createdAt)),
  ]);
  return campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    runs: runRows
      .filter((r) => r.campaignId === c.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        totalLeads: r.totalLeads,
        completedLeads: r.completedLeads,
        failedLeads: r.failedLeads,
        createdAt: r.createdAt.toISOString(),
      })),
  }));
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: PageProps) {
  let user;
  try {
    user = await getUserById(params.id);
  } catch {
    notFound();
  }

  const [stats, userCampaigns, creditTx] = await Promise.all([
    getActivityStats(params.id),
    getCampaignsWithRuns(params.id),
    listTransactions({ userId: params.id, limit: 100 }),
  ]);

  const creditHistory = creditTx.map((t) => ({
    id: String(t.id),
    kind: t.kind,
    delta: t.delta,
    balanceAfter: t.balanceAfter,
    reason: t.reason,
    stripeRef: t.stripeRef,
    createdAt:
      typeof t.createdAt === "string"
        ? t.createdAt
        : t.createdAt.toISOString(),
  }));

  const initialUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    companyName: user.companyName,
    vatId: user.vatId,
    billingStreet: user.billingStreet,
    billingZip: user.billingZip,
    billingCity: user.billingCity,
    billingCountry: user.billingCountry,
    createdAt:
      typeof user.createdAt === "string"
        ? user.createdAt
        : user.createdAt?.toISOString() ?? null,
    lastLoginAt:
      typeof user.lastLoginAt === "string"
        ? user.lastLoginAt
        : user.lastLoginAt?.toISOString() ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    subscriptionCurrentPeriodEnd:
      user.subscriptionCurrentPeriodEnd instanceof Date
        ? user.subscriptionCurrentPeriodEnd.toISOString()
        : (user.subscriptionCurrentPeriodEnd ?? null),
    stripeSubscriptionId: user.stripeSubscriptionId ?? null,
  };

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={displayName}
        subtitle={user.email}
        actions={
          <Button asChild variant="ghost" iconLeft={<ArrowLeft className="size-4" />}>
            <Link href="/admin/users">Zurück</Link>
          </Button>
        }
      />

      <UserDetailClient
        initialUser={initialUser}
        stats={stats}
        campaigns={userCampaigns}
        creditBalance={user.creditBalance}
        creditHistory={creditHistory}
        initialTab={searchParams?.tab ?? "profile"}
      />
    </div>
  );
}
