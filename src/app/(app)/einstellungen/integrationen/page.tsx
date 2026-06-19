import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { IntegrationsList } from "./integrations-list";

/**
 * Standalone-Seite für CRM-Integrationen.
 *
 * Wird vom Campaign-CRM-Tab via "Neue Integration anlegen →" verlinkt.
 * Identische UI wie der Tab im Einstellungen-Bereich, nur mit eigenem
 * PageHeader.
 */
export default async function IntegrationenPage() {
  await requireUser();

  return (
    <>
      <PageHeader
        title="CRM-Integrationen"
        subtitle="HubSpot, Salessuite oder Close verbinden, um Lead-Events automatisch ins CRM zu spiegeln."
      />
      <IntegrationsList />
    </>
  );
}
