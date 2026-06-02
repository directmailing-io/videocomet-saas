import * as React from "react";
import { requireUser } from "@/lib/auth-guard";
import { AppShell } from "@/components/layouts/AppShell";
import { Toaster } from "@/components/ui/toaster";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireUser();

  return (
    <Toaster>
      <AppShell
        user={{
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        }}
      >
        {children}
      </AppShell>
    </Toaster>
  );
}
