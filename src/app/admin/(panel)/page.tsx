import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Users as UsersIcon, UserCheck, UserX, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalRow,
      activeRow,
      inactiveRow,
      recentLoginsRow,
      recentUsers,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.isActive, true)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.isActive, false)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(gte(users.lastLoginAt, sevenDaysAgo))),
      db
        .select()
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(10),
    ]);

    return {
      total: totalRow[0]?.count ?? 0,
      active: activeRow[0]?.count ?? 0,
      inactive: inactiveRow[0]?.count ?? 0,
      recentLogins: recentLoginsRow[0]?.count ?? 0,
      recentUsers,
    };
  } catch {
    return {
      total: 0,
      active: 0,
      inactive: 0,
      recentLogins: 0,
      recentUsers: [] as (typeof users.$inferSelect)[],
    };
  }
}

function formatDate(d: Date | null | string): string {
  if (!d) return "nie";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Administrator-Übersicht"
        subtitle="Aktueller Stand der Plattform und letzte Benutzer-Aktivitäten."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          label="Gesamt User"
          value={data.total}
          icon={<UsersIcon />}
        />
        <StatCard
          label="Aktive User"
          value={data.active}
          icon={<UserCheck />}
        />
        <StatCard
          label="Inaktive User"
          value={data.inactive}
          icon={<UserX />}
        />
        <StatCard
          label="Anmeldungen (7d)"
          value={data.recentLogins}
          icon={<Clock />}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Zuletzt angelegte User
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Die letzten 10 Konten in der Datenbank.
            </p>
          </div>
          <Link
            href="/admin/users"
            className="text-xs font-semibold text-brand-deep hover:underline"
          >
            Alle anzeigen
          </Link>
        </div>
        {data.recentUsers.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Noch keine User"
            subtitle="Lege den ersten Benutzer an, um zu starten."
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {data.recentUsers.map((u) => {
              const initials = getInitials(u.firstName, u.lastName, u.email);
              const displayName =
                [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
              return (
                <li key={u.id}>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-soft"
                  >
                    <Avatar size="sm">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold text-ink">
                        {displayName}
                      </span>
                      <span className="truncate text-xs text-ink-muted">
                        {u.email}
                      </span>
                    </div>
                    <Badge variant={u.role === "admin" ? "brand" : "neutral"}>
                      {u.role === "admin" ? "Admin" : "User"}
                    </Badge>
                    <Badge
                      variant={u.isActive ? "success" : "neutral"}
                      dot
                      className="hidden sm:inline-flex"
                    >
                      {u.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    <span className="hidden md:inline-block text-xs text-ink-muted shrink-0 w-24 text-right">
                      {formatDate(u.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
