import { AlertTriangle, Mail, Reply, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  listAllEmailBlastsForAdmin,
  type AdminEmailBlastRow,
} from "@/lib/db/queries/email-blasts";
import { AdminEmailOutreach } from "./admin-email-outreach";

export const dynamic = "force-dynamic";

function bounceRate(b: AdminEmailBlastRow): number {
  return b.sentCount > 0 ? b.bouncedCount / b.sentCount : 0;
}

export default async function AdminEmailOutreachPage(): Promise<JSX.Element> {
  let blasts: AdminEmailBlastRow[] = [];
  try {
    blasts = await listAllEmailBlastsForAdmin();
  } catch {
    // DB nicht erreichbar — leere Liste rendern.
  }

  const running = blasts.filter((b) => b.status === "running").length;
  const sentTotal = blasts.reduce((s, b) => s + b.sentCount, 0);
  const repliedTotal = blasts.reduce((s, b) => s + b.repliedCount, 0);
  const highBounce = blasts.filter((b) => bounceRate(b) > 0.05).length;

  const initialBlasts = blasts.map((b) => ({
    id: b.id,
    userEmail: b.userEmail,
    campaignName: b.campaignName,
    status: b.status,
    sentCount: b.sentCount,
    totalCount: b.totalCount,
    bouncedCount: b.bouncedCount,
    repliedCount: b.repliedCount,
    startedAt: b.startedAt ? b.startedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="E-Mail-Outreach"
        subtitle="Alle E-Mail-Blasts über alle Kunden — Kill-Switch, Bounce-Überwachung und Suppression-Suche."
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Laufende Blasts" value={running} icon={<Send />} />
        <StatCard label="Mails versendet" value={sentTotal} icon={<Mail />} />
        <StatCard label="Antworten" value={repliedTotal} icon={<Reply />} />
        <StatCard
          label="Bounce-Quote > 5 %"
          value={highBounce}
          icon={<AlertTriangle />}
        />
      </div>
      <AdminEmailOutreach initialBlasts={initialBlasts} />
    </>
  );
}
