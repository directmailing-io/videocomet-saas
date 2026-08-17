import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { ApiKeysPanel } from "./api-keys-panel";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Kontakte-Eingang (Zapier & Co.)"
        subtitle="Lass Zapier, Make oder n8n neue Kontakte in deine Listen einfügen. Automatisch wird dann ein Video (oder PDF-Brief) erstellt."
      />
      <ApiKeysPanel />
    </>
  );
}
