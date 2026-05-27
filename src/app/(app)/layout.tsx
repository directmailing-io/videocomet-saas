import * as React from "react";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth-guard";
import { AppShell, type AppNavKey } from "@/components/layouts/AppShell";
import { Toaster } from "@/components/ui/toaster";

function navKeyFromPathname(pathname: string | null): AppNavKey {
  if (!pathname) return "dashboard";
  if (pathname.startsWith("/kampagnen")) return "campaigns";
  if (pathname.startsWith("/mediathek")) return "media";
  if (pathname.startsWith("/landingpages")) return "landingpages";
  if (pathname.startsWith("/einstellungen")) return "settings";
  return "dashboard";
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireUser();

  // Best-effort pathname detection for nav highlighting via x-pathname header
  // (Next.js exposes this on server components in some hosting setups).
  // Falls back to "dashboard" if unavailable.
  const h = await headers();
  const pathname =
    h.get("x-pathname") ?? h.get("x-invoke-path") ?? h.get("next-url") ?? null;
  const currentNav = navKeyFromPathname(pathname);

  return (
    <Toaster>
      <AppShell
        user={{
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        }}
        currentNav={currentNav}
      >
        {children}
      </AppShell>
    </Toaster>
  );
}
