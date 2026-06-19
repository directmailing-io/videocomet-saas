import { requireUser } from "@/lib/auth-guard";
import { getUserById } from "@/lib/db/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileForm, BillingForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { DomainsTab } from "./domains-tab";
import { IntegrationsList } from "./integrationen/integrations-list";

export default async function EinstellungenPage() {
  const { user: sessionUser } = await requireUser();
  const user = await getUserById(sessionUser.id);

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Verwalten Sie Profil, Passwort, Rechnungsadresse und Custom-Domains."
      />

      <Tabs defaultValue="profil">
        <TabsList>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="passwort">Passwort</TabsTrigger>
          <TabsTrigger value="rechnung">Rechnungsadresse</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="crm">CRM-Integrationen</TabsTrigger>
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

        <TabsContent value="crm">
          <IntegrationsList />
        </TabsContent>
      </Tabs>
    </>
  );
}
