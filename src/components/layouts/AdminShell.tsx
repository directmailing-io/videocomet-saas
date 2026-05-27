"use client";

import * as React from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  ServerCog,
  Settings,
  LogOut,
  Menu,
  User as UserIcon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, getInitials } from "@/lib/utils";

export type AdminNavKey = "dashboard" | "users" | "system" | "settings";

export interface AdminShellUser {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface AdminShellProps {
  children: React.ReactNode;
  user: AdminShellUser;
  currentNav: AdminNavKey;
  pageTitle?: string;
  breadcrumb?: React.ReactNode;
  headerActions?: React.ReactNode;
}

interface NavItem {
  key: AdminNavKey;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { key: "users", label: "User-Verwaltung", href: "/admin/users", icon: Users },
  { key: "system", label: "System", href: "/admin/system", icon: ServerCog },
  { key: "settings", label: "Einstellungen", href: "/admin/settings", icon: Settings },
];

function NavList({
  current,
  onSelect,
}: {
  current: AdminNavKey;
  onSelect?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ key, label, href, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={href}
            onClick={onSelect}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-squircle-sm px-3 text-sm font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-deep"
                : "text-ink-soft hover:bg-line-soft hover:text-ink"
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-brand-deep" : "text-ink-muted group-hover:text-ink"
              )}
            />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: AdminShellUser }) {
  const initials = getInitials(user.firstName, user.lastName, user.email);
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-squircle-md p-2 text-left transition-colors hover:bg-line-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-ink">
              {displayName}
            </span>
            <span className="truncate text-xs text-ink-muted">{user.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>Administrator</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/settings">
            <UserIcon className="size-4 text-ink-muted" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/admin/settings">
            <Settings className="size-4 text-ink-muted" />
            Einstellungen
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild danger>
          <Link href="/api/auth/logout">
            <LogOut className="size-4" />
            Abmelden
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarInner({
  current,
  user,
  onSelect,
}: {
  current: AdminNavKey;
  user: AdminShellUser;
  onSelect?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex flex-col gap-2.5 px-5 py-4 border-b border-line">
        <Logo variant="horizontal" height={24} />
        <Badge variant="brand" className="self-start">
          Administrator
        </Badge>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavList current={current} onSelect={onSelect} />
      </div>
      <div className="border-t border-line p-3">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

export function AdminShell({
  children,
  user,
  currentNav,
  pageTitle,
  breadcrumb,
  headerActions,
}: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const currentLabel = NAV.find((n) => n.key === currentNav)?.label ?? "";

  return (
    <div className="flex min-h-screen bg-surface-soft">
      <aside className="hidden md:flex md:w-[240px] md:shrink-0 md:border-r md:border-line md:bg-surface md:sticky md:top-0 md:h-screen">
        <SidebarInner current={currentNav} user={user} />
      </aside>

      <div className="flex flex-1 min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 backdrop-blur px-4 sm:px-6">
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="md:hidden inline-flex size-9 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                aria-label="Menue öffnen"
              >
                <Menu className="size-5 text-ink" />
              </button>
            </DialogTrigger>
            <DialogContent
              size="sm"
              showClose={false}
              className="left-0 top-0 h-full w-[260px] max-w-[260px] translate-x-0 translate-y-0 rounded-none rounded-r-squircle-xl p-0"
            >
              <DialogTitle className="sr-only">Administration</DialogTitle>
              <SidebarInner
                current={currentNav}
                user={user}
                onSelect={() => setMobileOpen(false)}
              />
            </DialogContent>
          </Dialog>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex min-w-0 flex-col">
              {breadcrumb && (
                <div className="text-xs text-ink-muted truncate">
                  {breadcrumb}
                </div>
              )}
              <h1 className="text-sm font-semibold text-ink truncate">
                {pageTitle ?? currentLabel}
              </h1>
            </div>
          </div>

          {headerActions && (
            <div className="flex items-center gap-2 shrink-0">
              {headerActions}
            </div>
          )}
        </header>

        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-7xl p-6 sm:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
