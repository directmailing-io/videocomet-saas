import { desc, gte } from "drizzle-orm";
import { Activity, Server } from "lucide-react";
import { db } from "@/lib/db";
import { adminAuditLog, workerHeartbeats } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HealthCard } from "./health-card";

export const dynamic = "force-dynamic";

async function getActiveWorkers() {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const rows = await db
      .select()
      .from(workerHeartbeats)
      .where(gte(workerHeartbeats.lastSeenAt, twoMinutesAgo))
      .orderBy(workerHeartbeats.workerId);
    return rows;
  } catch {
    return [];
  }
}

const AUDIT_LABELS: Record<string, string> = {
  "user.create": "Nutzer angelegt",
  "user.update": "Nutzerprofil geändert",
  "user.delete": "Nutzer gelöscht",
  "user.activate": "Nutzer aktiviert",
  "user.deactivate": "Nutzer deaktiviert",
  "user.set_password": "Passwort für Nutzer gesetzt",
  "user.send_reset": "Passwort-Reset-Mail gesendet",
  "user.comp_access.grant": "Gratis-Zugang gewährt",
  "user.comp_access.revoke": "Gratis-Zugang entzogen",
  "billing.adjust": "Credits angepasst",
  "domain.recheck": "Domain neu geprüft",
  "domain.reset": "Domain zurückgesetzt",
  "domain.delete": "Domain gelöscht",
  "email_blast.cancel": "E-Mail-Versand abgebrochen",
  "run.regenerate": "Runde neu generiert",
  "lead.regenerate": "Lead neu generiert",
  "totp.enable": "Zwei-Faktor aktiviert",
  "totp.disable": "Zwei-Faktor deaktiviert",
};

async function getRecentAuditEntries() {
  try {
    return await db
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(50);
  } catch {
    return [];
  }
}

function formatDateTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function AdminSystemPage() {
  const [workers, audit] = await Promise.all([getActiveWorkers(), getRecentAuditEntries()]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="System-Status"
        subtitle="Live-Status von Datenbank, Worker-Pool und Job-Queue."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4 text-ink-muted" />
              Worker-Pool
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workers.length === 0 ? (
              <div className="text-sm text-ink-muted py-4">
                Aktuell keine aktiven Worker (Heartbeat &lt; 2 Min.).
              </div>
            ) : (
              <ul className="divide-y divide-line-soft">
                {workers.map((w) => {
                  const seenAt =
                    typeof w.lastSeenAt === "string"
                      ? new Date(w.lastSeenAt)
                      : w.lastSeenAt;
                  return (
                    <li
                      key={w.workerId}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">
                          {w.workerId}
                        </p>
                        <p className="text-xs text-ink-muted truncate">
                          {w.hostname} · {w.currentJobs} aktive Jobs
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="success" dot>
                          Live
                        </Badge>
                        <span className="text-xs text-ink-muted font-mono">
                          {formatTime(seenAt)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-ink-muted" />
              Admin-Protokoll
            </CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <div className="rounded-squircle-sm border border-dashed border-line bg-surface-soft p-6 text-center">
                <p className="text-sm text-ink-muted">
                  Noch keine Einträge. Hier erscheint jede Admin-Aktion (Passwörter, Credits, Löschungen, Domains, Re-Renders).
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pr-4 font-semibold">Zeit</th>
                      <th className="py-2 pr-4 font-semibold">Aktion</th>
                      <th className="py-2 pr-4 font-semibold">Ziel</th>
                      <th className="py-2 pr-4 font-semibold">Admin</th>
                      <th className="py-2 pr-4 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {audit.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-ink-muted">{formatDateTime(a.createdAt)}</td>
                        <td className="py-2 pr-4 font-medium text-ink">{AUDIT_LABELS[a.action] ?? a.action}</td>
                        <td className="py-2 pr-4 text-ink-muted">
                          {(a.details as Record<string, unknown> | null)?.targetEmail as string | undefined
                            ?? (a.details as Record<string, unknown> | null)?.hostname as string | undefined
                            ?? (a.details as Record<string, unknown> | null)?.email as string | undefined
                            ?? (a.targetId ? `${a.targetType ?? ""} ${a.targetId.slice(0, 8)}…` : "–")}
                        </td>
                        <td className="py-2 pr-4 text-ink-muted">{a.adminEmail ?? "–"}{a.ip ? <span className="block text-[11px] font-mono">{a.ip}</span> : null}</td>
                        <td className="py-2 pr-4 text-xs text-ink-muted font-mono break-all max-w-[360px]">
                          {a.details ? JSON.stringify(a.details) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
