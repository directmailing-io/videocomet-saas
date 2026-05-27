import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { UsersListClient } from "./users-list-client";
import { listUsers, type UserRole } from "@/lib/db/queries/users";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: {
    search?: string;
    status?: string;
    role?: string;
  };
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const search = searchParams?.search?.trim() || undefined;
  const role: UserRole | undefined =
    searchParams?.role === "admin" || searchParams?.role === "user"
      ? searchParams.role
      : undefined;
  const status = searchParams?.status ?? "all";

  let items: Awaited<ReturnType<typeof listUsers>>["items"] = [];
  let total = 0;
  try {
    const result = await listUsers({ search, role, limit: 200 });
    items = result.items;
    total = result.total;
  } catch {
    // DB nicht erreichbar — leere Liste rendern
  }

  const filtered =
    status === "active"
      ? items.filter((u) => u.isActive)
      : status === "inactive"
      ? items.filter((u) => !u.isActive)
      : items;

  const initialUsers = filtered.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    companyName: u.companyName,
    role: u.role,
    isActive: u.isActive,
    createdAt:
      typeof u.createdAt === "string"
        ? u.createdAt
        : u.createdAt?.toISOString() ?? null,
    lastLoginAt:
      typeof u.lastLoginAt === "string"
        ? u.lastLoginAt
        : u.lastLoginAt?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="User-Verwaltung"
        subtitle={`${total} Benutzer in der Datenbank.`}
        actions={
          <Button asChild iconLeft={<Plus className="size-4" />}>
            <Link href="/admin/users/neu">Neuer User</Link>
          </Button>
        }
      />

      <UsersListClient
        initialUsers={initialUsers}
        initialSearch={search ?? ""}
        initialStatus={status}
        initialRole={searchParams?.role ?? "all"}
      />
    </div>
  );
}
