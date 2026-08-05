import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { KiStimmeTab } from "../einstellungen/ki-stimme-tab";

export const dynamic = "force-dynamic";

export default async function KiBegruessungPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="KI-Begrüßung"
        subtitle="Richte einmalig deine KI-Stimme ein. Danach kann jede Kampagne Leads persönlich mit Vornamen begrüßen (2 Credits pro Video)."
      />
      <KiStimmeTab />
    </>
  );
}
