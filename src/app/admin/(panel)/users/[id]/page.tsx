import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getUserById } from "@/lib/db/queries/users";
import { db } from "@/lib/db";
import { campaigns, runs, mediaItems } from "@/lib/db/schema";
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

  const stats = await getActivityStats(params.id);

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
        initialTab={searchParams?.tab ?? "profile"}
      />
    </div>
  );
}
