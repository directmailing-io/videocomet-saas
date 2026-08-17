import { requireUser } from "@/lib/auth-guard";
import { getUserById } from "@/lib/db/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileForm, BillingForm, NotificationsForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { DomainsTab } from "./domains-tab";
import { MailboxesTab } from "./mailboxes-tab";
import { IntegrationsList } from "./integrationen/integrations-list";
import { WebhooksList } from "./webhooks/webhooks-list";
import { WebhooksDocsCallout } from "./webhooks/webhooks-docs-callout";
import { ApiKeysPanel } from "./api-keys/api-keys-panel";
import { BillingTab } from "./billing-tab";
import { KiStimmeTab } from "./ki-stimme-tab";
import { SetupTab } from "./setup-tab";
import { getSetupStatus } from "@/lib/setup-status";
import { buildAdminConsentUrl, isM365Configured } from "@/lib/msgraph/client";

const TAB_VALUES = new Set([
  "setup",
  "profil",
  "passwort",
  "abrechnung",
  "rechnung",
  "domains",
  "postfaecher",
  "ki-stimme",
  "crm",
  "webhooks",
  "automation",
]);

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user: sessionUser } = await requireUser();
  const [user, setupStatus] = await Promise.all([
    getUserById(sessionUser.id),
    getSetupStatus(sessionUser.id),
  ]);
  const params = await searchParams;

  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const defaultTab = TAB_VALUES.has(tabParam) ? tabParam : "profil";
  const m365Error = typeof params.m365Error === "string" ? params.m365Error : null;
  const m365Connected = params.m365 === "connected";

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Hier verwaltest du Profil, Passwort, Rechnungsadresse, Domains und E-Mail-Postfächer."
      />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="passwort">Passwort</TabsTrigger>
          <TabsTrigger value="abrechnung">Abrechnung</TabsTrigger>
          <TabsTrigger value="rechnung">Rechnungsadresse</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="postfaecher">E-Mail-Postfächer</TabsTrigger>
          <TabsTrigger value="ki-stimme">KI-Stimme</TabsTrigger>
          <TabsTrigger value="crm">CRM-Integrationen</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="automation">Automation-API</TabsTrigger>
        </TabsList>

        <TabsContent value="setup">
          <SetupTab status={setupStatus} />
        </TabsContent>

        <TabsContent value="profil">
          <Card>
            <CardContent className="p-6">
              <ProfileForm
                initialValues={{
                  email: user.email,
                  firstName: user.firstName ?? "",
                  lastName: user.lastName ?? "",
                  phone: user.phone ?? "",
                  companyName: user.companyName ?? "",
                  vatId: user.vatId ?? "",
                }}
              />
            </CardContent>
          </Card>
          <Card className="mt-6">
            <CardContent className="p-6">
              <NotificationsForm
                initialNotifyRunEmails={user.notifyRunEmails}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="passwort">
          <Card>
            <CardContent className="p-6">
              <PasswordForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abrechnung">
          <BillingTab />
        </TabsContent>

        <TabsContent value="rechnung">
          <Card>
            <CardContent className="p-6">
              <BillingForm
                initialValues={{
                  billingStreet: user.billingStreet ?? "",
                  billingZip: user.billingZip ?? "",
                  billingCity: user.billingCity ?? "",
                  billingCountry: user.billingCountry ?? "DE",
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains">
          <DomainsTab />
        </TabsContent>

        <TabsContent value="postfaecher">
          <MailboxesTab
            m365Available={isM365Configured()}
            adminConsentUrl={buildAdminConsentUrl()}
            initialM365Error={m365Error}
            initialM365Connected={m365Connected}
          />
        </TabsContent>

        <TabsContent value="ki-stimme">
          <KiStimmeTab />
        </TabsContent>

        <TabsContent value="crm">
          <IntegrationsList />
        </TabsContent>

        <TabsContent value="webhooks">
          <div className="flex flex-col gap-6">
            <WebhooksDocsCallout />
            <WebhooksList />
          </div>
        </TabsContent>

        <TabsContent value="automation">
          <ApiKeysPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
