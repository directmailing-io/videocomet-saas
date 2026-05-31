import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CheckCircle2, Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import {
  listAllDomainsForAdmin,
  type AdminDomainRow,
} from "@/lib/db/queries/user-domains";
import { AdminDomainList } from "./admin-domain-list";

export const dynamic = "force-dynamic";

interface AdminDomainStats {
  active: number;
  verifying: number;
  failedOver1h: number;
  certExpiresUnder14d: number;
}

function computeStats(domains: AdminDomainRow[]): AdminDomainStats {
  const now = Date.now();
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  let active = 0;
  let verifying = 0;
  let failedOver1h = 0;
  let certExpiresUnder14d = 0;

  for (const d of domains) {
    if (d.status === "active") active += 1;
    if (
      d.status === "pending" ||
      d.status === "verifying" ||
      d.status === "issuing_cert"
    ) {
      verifying += 1;
    }
    if (d.status === "failed") {
      const lastTs = d.lastCheckedAt
        ? d.lastCheckedAt.getTime()
        : d.createdAt.getTime();
      if (now - lastTs > HOUR_MS) failedOver1h += 1;
    }
    if (
      d.status === "active" &&
      d.sslExpiresAt &&
      d.sslExpiresAt.getTime() - now < 14 * DAY_MS
    ) {
      certExpiresUnder14d += 1;
    }
  }

  return { active, verifying, failedOver1h, certExpiresUnder14d };
}

export default async function AdminDomainsPage(): Promise<JSX.Element> {
  let domains: AdminDomainRow[] = [];
  try {
    domains = await listAllDomainsForAdmin();
  } catch {
    // DB nicht erreichbar — leere Liste rendern, Stats bleiben auf 0.
  }

  const stats = computeStats(domains);

  // Serialize Dates → ISO so client component receives plain JSON.
  const initialDomains = domains.map((d) => ({
    id: d.id,
    hostname: d.hostname,
    kind: d.kind,
    status: d.status,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    sslIssuedAt: d.sslIssuedAt?.toISOString() ?? null,
    sslExpiresAt: d.sslExpiresAt?.toISOString() ?? null,
    lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    userId: d.userId,
    userEmail: d.userEmail,
    userName: d.userName,
  }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Custom-Domains"
        subtitle="Alle verbundenen Kunden-Domains, Status und Cert-Health."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label="Aktive Domains"
          value={stats.active}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="In Verifikation"
          value={stats.verifying}
          icon={<Loader2 />}
        />
        <StatCard
          label="Fehler > 1h"
          value={stats.failedOver1h}
          icon={<AlertTriangle />}
        />
        <StatCard
          label="Cert läuft < 14 Tage"
          value={stats.certExpiresUnder14d}
          icon={<ShieldAlert />}
        />
      </div>

      <AdminDomainList initialDomains={initialDomains} />
    </div>
  );
}
