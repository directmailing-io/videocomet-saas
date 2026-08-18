import * as React from "react";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth-guard";
import { AdminShell, type AdminNavKey } from "@/components/layouts/AdminShell";
import { Toaster } from "@/components/ui/toaster";

function navKeyFromPathname(pathname: string | null): AdminNavKey {
  if (!pathname) return "dashboard";
  if (pathname.startsWith("/admin/domains")) return "domains";
  if (pathname.startsWith("/admin/email-outreach")) return "email";
  if (pathname.startsWith("/admin/meta-events")) return "meta-events";
  if (pathname.startsWith("/admin/users")) return "users";
  if (pathname.startsWith("/admin/system")) return "system";
  if (pathname.startsWith("/admin/settings") || pathname.startsWith("/admin/einstellungen")) {
    return "settings";
  }
  return "dashboard";
}

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireAdmin();

  const h = await headers();
  const pathname =
    h.get("x-pathname") ?? h.get("x-invoke-path") ?? h.get("next-url") ?? null;
  const currentNav = navKeyFromPathname(pathname);

  return (
    <Toaster>
      <AdminShell
        user={{
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        }}
        currentNav={currentNav}
      >
        {children}
      </AdminShell>
    </Toaster>
  );
}
