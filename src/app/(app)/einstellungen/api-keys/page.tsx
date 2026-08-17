import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { ApiKeysPanel } from "./api-keys-panel";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Automation-API"
        subtitle="Zapier, Make oder n8n verbinden — automatisch Kontakte in Listen füttern und Videos generieren."
      />
      <ApiKeysPanel />
    </>
  );
}
