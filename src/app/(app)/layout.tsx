import * as React from "react";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth-guard";
import { AppShell } from "@/components/layouts/AppShell";
import { Toaster } from "@/components/ui/toaster";
import { loadAccessDecision, isPathAllowedWhenBlocked } from "@/lib/billing/access-gate";
import { PaywallScreen } from "@/components/billing/paywall-screen";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireUser();

  // Access-Gate: prueft die Subscription. Wenn gesperrt UND der aktuelle
  // Pfad ist NICHT auf der Ausnahme-Liste, zeigen wir den Paywall-Screen
  // statt dem regulaeren Content. Ausnahmen: /einstellungen (damit User
  // Abrechnung sieht) + Billing-APIs.
  const access = await loadAccessDecision(user.id);
  const pathname = (await headers()).get("x-pathname") ?? "";
  const showPaywall =
    access.access === "blocked" && !isPathAllowedWhenBlocked(pathname);

  return (
    <Toaster>
      <AppShell
        user={{
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        }}
      >
        {showPaywall ? (
          <PaywallScreen
            reason={access.reason}
            periodEnd={access.periodEnd ? access.periodEnd.toISOString() : null}
          />
        ) : (
          children
        )}
      </AppShell>
    </Toaster>
  );
}
