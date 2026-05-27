"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  MoreHorizontal,
  Pencil,
  KeyRound,
  Mail,
  Power,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";
import { Card } from "@/components/ui/card";

export interface AdminUserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

interface Props {
  initialUsers: AdminUserRow[];
  initialSearch: string;
  initialStatus: string;
  initialRole: string;
}

function formatDate(d: string | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(d: string | null): string {
  if (!d) return "nie";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UsersListClient({
  initialUsers,
  initialSearch,
  initialStatus,
  initialRole,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = React.useState(initialSearch);
  const [status, setStatus] = React.useState(initialStatus);
  const [role, setRole] = React.useState(initialRole);
  const [isPending, startTransition] = React.useTransition();

  const applyFilters = React.useCallback(
    (next: { search?: string; status?: string; role?: string }) => {
      const params = new URLSearchParams();
      const s = next.search ?? search;
      const st = next.status ?? status;
      const r = next.role ?? role;
      if (s) params.set("search", s);
      if (st && st !== "all") params.set("status", st);
      if (r && r !== "all") params.set("role", r);
      const qs = params.toString();
      startTransition(() => {
        router.push(`/admin/users${qs ? `?${qs}` : ""}`);
      });
    },
    [router, search, status, role],
  );

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (search !== initialSearch) {
        applyFilters({ search });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function toggleActive(u: AdminUserRow) {
    const path = u.isActive
      ? `/api/admin/users/${u.id}/deactivate`
      : `/api/admin/users/${u.id}/activate`;
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) throw new Error();
      toast({
        title: u.isActive ? "User deaktiviert" : "User aktiviert",
        variant: "success",
      });
      router.refresh();
    } catch {
      toast({ title: "Aktion fehlgeschlagen.", variant: "danger" });
    }
  }

  async function sendResetMail(u: AdminUserRow) {
    try {
      const res = await fetch(`/api/admin/users/${u.id}/send-reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast({ title: `Reset-Mail an ${u.email} gesendet.`, variant: "success" });
    } catch {
      toast({ title: "Mail-Versand fehlgeschlagen.", variant: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <Input
            icon={<Search />}
            placeholder="Suche nach Name, E-Mail oder Firma"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              applyFilters({ status: v });
            }}
          >
            <SelectTrigger className="w-[160px] h-[46px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="inactive">Inaktiv</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v);
              applyFilters({ role: v });
            }}
          >
            <SelectTrigger className="w-[160px] h-[46px]">
              <SelectValue placeholder="Rolle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Rollen</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isPending && (
        <div className="text-xs text-ink-muted">Aktualisiere Liste...</div>
      )}

      {initialUsers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon />}
            title="Keine User gefunden"
            subtitle="Passe die Filter an oder lege einen neuen User an."
          />
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Firma</TableHead>
              <TableHead>Rolle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Erstellt</TableHead>
              <TableHead>Letzte Anmeldung</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsers.map((u) => {
              const initials = getInitials(u.firstName, u.lastName, u.email);
              const displayName =
                [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="flex items-center gap-3 min-w-0"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-ink">
                          {displayName}
                        </span>
                        <span className="truncate text-xs text-ink-muted">
                          {u.email}
                        </span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {u.companyName || "–"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "brand" : "neutral"}>
                      {u.role === "admin" ? "Admin" : "User"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "success" : "neutral"} dot>
                      {u.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {formatDateTime(u.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                          aria-label="Aktionen"
                        >
                          <MoreHorizontal className="size-4 text-ink-muted" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/users/${u.id}`}>
                            <Pencil className="size-4 text-ink-muted" />
                            Bearbeiten
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => toggleActive(u)}
                        >
                          <Power className="size-4 text-ink-muted" />
                          {u.isActive ? "Deaktivieren" : "Aktivieren"}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/users/${u.id}?tab=security`}>
                            <KeyRound className="size-4 text-ink-muted" />
                            Passwort setzen
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => sendResetMail(u)}>
                          <Mail className="size-4 text-ink-muted" />
                          Reset-Mail senden
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild danger>
                          <Link href={`/admin/users/${u.id}?tab=danger`}>
                            <Trash2 className="size-4" />
                            Löschen
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
