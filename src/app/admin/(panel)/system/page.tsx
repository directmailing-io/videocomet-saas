import { sql, gte } from "drizzle-orm";
import { Activity, Server } from "lucide-react";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";
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

function formatTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function AdminSystemPage() {
  const workers = await getActiveWorkers();

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
              Job-Queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-squircle-sm border border-dashed border-line bg-surface-soft p-6 text-center">
              <p className="text-sm text-ink-muted">
                Wird vom Worker-Agent gefüllt.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
