"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Library,
  LayoutTemplate,
  Settings,
  LogOut,
  Menu,
  User as UserIcon,
  BarChart3,
  Users2,
  Mail as MailIcon,
  AtSign,
  Send,
  Sparkles,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CreditBalanceCard } from "@/components/billing/credit-balance-card";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";
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

export type AppNavKey =
  | "dashboard"
  | "campaigns"
  | "contacts"
  | "analytics"
  | "emailBlasts"
  | "media"
  | "landingpages"
  | "envelopes"
  | "emailTemplates"
  | "kiIntro"
  | "settings";

export interface AppShellUser {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface AppShellProps {
  children: React.ReactNode;
  user: AppShellUser;
  pageTitle?: string;
  breadcrumb?: React.ReactNode;
  headerActions?: React.ReactNode;
}

interface NavItem {
  key: AppNavKey;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Zusätzliche Pfad-Präfixe die das Item ebenfalls als aktiv markieren. */
  matchPrefixes?: string[];
}

// "Aktivität" und "Analytics" sind als ein Nav-Punkt zusammengeführt — beide
// Routen highlighten denselben Eintrag, die Sub-Navigation innerhalb der Seite
// schaltet zwischen Übersicht und Live-Feed.
const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { key: "campaigns", label: "Kampagnen", href: "/kampagnen", icon: Megaphone },
      { key: "contacts", label: "Kontakte & Listen", href: "/kontakte", icon: Users2 },
      {
        key: "analytics",
        label: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        matchPrefixes: ["/aktivitaet"],
      },
      {
        key: "emailBlasts",
        label: "E-Mail-Versand",
        href: "/email-versand",
        icon: Send,
      },
    ],
  },
  {
    label: "Setup",
    items: [
      { key: "media", label: "Mediathek", href: "/mediathek", icon: Library },
      { key: "landingpages", label: "Landingpages", href: "/landingpages", icon: LayoutTemplate },
      { key: "envelopes", label: "Umschläge", href: "/umschlaege", icon: MailIcon },
      { key: "emailTemplates", label: "E-Mail-Vorlagen", href: "/email-vorlagen", icon: AtSign },
      { key: "kiIntro", label: "KI-Begrüßung", href: "/ki-begruessung", icon: Sparkles },
      { key: "settings", label: "Einstellungen", href: "/einstellungen", icon: Settings },
    ],
  },
];

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function isNavActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href || pathname.startsWith(item.href + "/")) return true;
  if (item.matchPrefixes) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
  }
  return false;
}

function NavList({ onSelect }: { onSelect?: () => void }) {
  const pathname = usePathname() ?? "/dashboard";
  return (
    <nav className="flex flex-col px-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label ?? gi} className={cn("flex flex-col gap-0.5", gi > 0 && "mt-6")}>
          {group.label && (
            <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              {group.label}
            </span>
          )}
          {group.items.map((item) => {
            const { key, label, href, icon: Icon } = item;
            const active = isNavActive(item, pathname);
            return (
              <Link
                key={key}
                href={href}
                onClick={onSelect}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-full px-3.5 text-sm font-medium transition-all",
                  active
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-soft hover:bg-surface/60 hover:text-ink"
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
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ user }: { user: AppShellUser }) {
  const initials = getInitials(user.firstName, user.lastName, user.email);
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-squircle-md p-2 text-left transition-colors hover:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
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
        <DropdownMenuLabel>Mein Konto</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/einstellungen">
            <UserIcon className="size-4 text-ink-muted" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/einstellungen">
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
  user,
  onSelect,
  brand,
}: {
  user: AppShellUser;
  onSelect?: () => void;
  brand?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-16 items-center gap-3 px-5">
        <Logo variant="horizontal" height={36} />
      </div>
      {brand && <div className="px-5 py-3">{brand}</div>}
      <div className="flex-1 overflow-y-auto py-4">
        <NavList onSelect={onSelect} />
      </div>
      <CreditBalanceCard />
      <div className="p-3">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

export function AppShell({
  children,
  user,
  pageTitle,
  breadcrumb,
  headerActions,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname() ?? "/dashboard";
  const currentLabel =
    NAV.find((n) => isNavActive(n, pathname))?.label ?? "";

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Desktop sidebar — transparent auf dem Canvas, Inhalt "schwebt" daneben */}
      <aside className="hidden md:flex md:w-[240px] md:shrink-0 md:sticky md:top-0 md:h-screen">
        <SidebarInner user={user} />
      </aside>

      <div className="flex flex-1 min-w-0 flex-col">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-canvas/80 backdrop-blur px-4 sm:px-6">
          {/* Mobile menu */}
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
              className="left-0 top-0 h-full w-[260px] max-w-[260px] translate-x-0 translate-y-0 rounded-none rounded-r-squircle-xl bg-canvas p-0"
            >
              <DialogTitle className="sr-only">Navigation</DialogTitle>
              <SidebarInner
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

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-7xl p-6 sm:p-8">{children}</div>
        </main>
      </div>

      <OnboardingChecklist />
    </div>
  );
}
