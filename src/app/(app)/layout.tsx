import * as React from "react";
import { cookies, headers } from "next/headers";
import { requireUser } from "@/lib/auth-guard";
import { AppShell } from "@/components/layouts/AppShell";
import { Toaster } from "@/components/ui/toaster";
import { loadAccessDecision, isPathAllowedWhenBlocked } from "@/lib/billing/access-gate";
import { PaywallScreen } from "@/components/billing/paywall-screen";
import { CookieBanner } from "@/components/consent/CookieBanner";
import { MetaPixelLoader } from "@/components/meta/meta-pixel-loader";
import { CONSENT_COOKIE, parseConsentCookie } from "@/components/consent/consent-parse";

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

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  const consentCookie = (await cookies()).get(CONSENT_COOKIE)?.value;
  const initialConsent = parseConsentCookie(consentCookie);
  const marketingConsent = initialConsent?.categories.marketing === true;
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
      <CookieBanner initialConsent={initialConsent} />
      {pixelId ? (
        <MetaPixelLoader
          pixelId={pixelId}
          initialMarketingConsent={marketingConsent}
        />
      ) : null}
    </Toaster>
  );
}
