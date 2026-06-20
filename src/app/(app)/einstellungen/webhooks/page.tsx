import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { WebhooksList } from "./webhooks-list";
import { WebhooksDocsCallout } from "./webhooks-docs-callout";

/**
 * Dedizierte Server-Route für Webhooks. Wird primär aus dem Einstellungen-
 * Tab "Webhooks" verlinkt (Direkt-Bookmark möglich), kann aber auch als
 * Standalone-Page besucht werden.
 *
 * Die eigentliche Liste ist client-side (Fetch + State) — diese Page ist nur
 * ein Auth-Gate und Render-Wrapper.
 */
export default async function WebhooksPage() {
  await requireUser();

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Senden Sie VideoComet-Events automatisch an Make.com, Zapier oder einen eigenen HTTPS-Endpunkt."
      />

      <div className="flex flex-col gap-6">
        <WebhooksDocsCallout />
        <WebhooksList />
      </div>
    </>
  );
}
