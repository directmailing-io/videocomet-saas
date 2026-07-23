import { requireUser } from "@/lib/auth-guard";
import { getUserById } from "@/lib/db/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileForm, BillingForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { DomainsTab } from "./domains-tab";
import { MailboxesTab } from "./mailboxes-tab";
import { IntegrationsList } from "./integrationen/integrations-list";
import { WebhooksList } from "./webhooks/webhooks-list";
import { WebhooksDocsCallout } from "./webhooks/webhooks-docs-callout";
import { BillingTab } from "./billing-tab";
import { buildAdminConsentUrl, isM365Configured } from "@/lib/msgraph/client";

const TAB_VALUES = new Set([
  "profil",
  "passwort",
  "abrechnung",
  "rechnung",
  "domains",
  "postfaecher",
  "crm",
  "webhooks",
]);

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user: sessionUser } = await requireUser();
  const user = await getUserById(sessionUser.id);
  const params = await searchParams;

  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const defaultTab = TAB_VALUES.has(tabParam) ? tabParam : "profil";
  const m365Error = typeof params.m365Error === "string" ? params.m365Error : null;
  const m365Connected = params.m365 === "connected";

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Verwalten Sie Profil, Passwort, Rechnungsadresse, Custom-Domains und E-Mail-Postfächer."
      />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="passwort">Passwort</TabsTrigger>
          <TabsTrigger value="abrechnung">Abrechnung</TabsTrigger>
          <TabsTrigger value="rechnung">Rechnungsadresse</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="postfaecher">E-Mail-Postfächer</TabsTrigger>
          <TabsTrigger value="crm">CRM-Integrationen</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

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

        <TabsContent value="crm">
          <IntegrationsList />
        </TabsContent>

        <TabsContent value="webhooks">
          <div className="flex flex-col gap-6">
            <WebhooksDocsCallout />
            <WebhooksList />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
