import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Circle, Target } from "lucide-react";
import { db } from "@/lib/db";
import { metaEventLog } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

interface SearchParams {
  event?: string;
  status?: "all" | "ok" | "fail";
}

async function loadRows(filter: SearchParams) {
  const conds = [];
  if (filter.event) conds.push(eq(metaEventLog.eventName, filter.event));
  if (filter.status === "ok") conds.push(eq(metaEventLog.ok, true));
  if (filter.status === "fail") conds.push(eq(metaEventLog.ok, false));

  const rows = await db
    .select({
      id: metaEventLog.id,
      eventName: metaEventLog.eventName,
      eventId: metaEventLog.eventId,
      userEmail: metaEventLog.userEmail,
      value: metaEventLog.value,
      currency: metaEventLog.currency,
      actionSource: metaEventLog.actionSource,
      sourceUrl: metaEventLog.sourceUrl,
      httpStatus: metaEventLog.httpStatus,
      ok: metaEventLog.ok,
      error: metaEventLog.error,
      sentAt: metaEventLog.sentAt,
    })
    .from(metaEventLog)
    .where(conds.length > 0 ? sql`${sql.join(conds, sql` AND `)}` : undefined)
    .orderBy(desc(metaEventLog.sentAt))
    .limit(PAGE_SIZE);
  return rows;
}

async function loadStats() {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${metaEventLog.ok} = true)::int`,
      fail: sql<number>`count(*) filter (where ${metaEventLog.ok} = false)::int`,
      last24hOk: sql<number>`count(*) filter (where ${metaEventLog.ok} = true AND ${metaEventLog.sentAt} > now() - interval '24 hours')::int`,
      last24hFail: sql<number>`count(*) filter (where ${metaEventLog.ok} = false AND ${metaEventLog.sentAt} > now() - interval '24 hours')::int`,
    })
    .from(metaEventLog);
  const perEvent = await db
    .select({
      eventName: metaEventLog.eventName,
      count: sql<number>`count(*)::int`,
    })
    .from(metaEventLog)
    .groupBy(metaEventLog.eventName)
    .orderBy(desc(sql`count(*)`));
  return { totals, perEvent };
}

function fmtWhen(d: Date): string {
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function MetaEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [rows, stats] = await Promise.all([loadRows(params), loadStats()]);
  const status = params.status ?? "all";
  const eventFilter = params.event ?? "";

  return (
    <>
      <PageHeader
        title="Meta Pixel"
        subtitle="Timeline aller CAPI-Events, die an Meta gesendet wurden. Pixel-ID: 1780111992987971"
      />

      <div className="grid gap-3 sm:grid-cols-4 mb-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-ink-muted uppercase tracking-wide">Insgesamt</p>
            <p className="text-2xl font-semibold text-ink">{stats.totals?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-ink-muted uppercase tracking-wide">Erfolg (24 h)</p>
            <p className="text-2xl font-semibold text-emerald-700">
              {stats.totals?.last24hOk ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-ink-muted uppercase tracking-wide">Fehler (24 h)</p>
            <p
              className={cn(
                "text-2xl font-semibold",
                (stats.totals?.last24hFail ?? 0) > 0 ? "text-danger" : "text-ink",
              )}
            >
              {stats.totals?.last24hFail ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-ink-muted uppercase tracking-wide">
              Erfolgsquote gesamt
            </p>
            <p className="text-2xl font-semibold text-ink">
              {stats.totals?.total
                ? `${Math.round(((stats.totals.ok ?? 0) / stats.totals.total) * 100)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {stats.perEvent.length > 0 && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-sm">Verteilung nach Event-Typ</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.perEvent.map((e) => (
              <Link
                key={e.eventName}
                href={`/admin/meta-events?event=${encodeURIComponent(e.eventName)}${status !== "all" ? `&status=${status}` : ""}`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition",
                  eventFilter === e.eventName
                    ? "bg-ink text-white"
                    : "bg-canvas-deep text-ink hover:bg-line",
                )}
              >
                {e.eventName}
                <span className="opacity-70">{e.count}</span>
              </Link>
            ))}
            {eventFilter && (
              <Link
                href={`/admin/meta-events${status !== "all" ? `?status=${status}` : ""}`}
                className="text-xs underline text-ink-muted self-center"
              >
                Filter zurücksetzen
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-ink-muted">Status:</span>
        {(["all", "ok", "fail"] as const).map((s) => {
          const label = s === "all" ? "Alle" : s === "ok" ? "Erfolg" : "Fehler";
          const href = `/admin/meta-events?${s !== "all" ? `status=${s}&` : ""}${
            eventFilter ? `event=${encodeURIComponent(eventFilter)}` : ""
          }`;
          return (
            <Link
              key={s}
              href={href}
              className={cn(
                "rounded-full px-3 py-1 font-semibold",
                status === s ? "bg-ink text-white" : "bg-canvas-deep text-ink-muted hover:text-ink",
              )}
            >
              {label}
            </Link>
          );
        })}
        <span className="ml-auto text-ink-muted">
          Zeigt neueste {rows.length} Einträge
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-sm text-ink-muted">
            <Target className="size-5 text-brand-deep" />
            <div>
              <b className="text-ink">Noch keine Events geloggt.</b>
              <p>
                Sobald Signups oder Käufe passieren, tauchen die CAPI-Events hier
                auf. Zum Testen: im Meta Events Manager unter „Test Events" den
                Testcode nehmen und einen Signup durchspielen.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl bg-surface shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-canvas-deep text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="text-left px-4 py-2 w-8"></th>
                <th className="text-left px-4 py-2">Wann</th>
                <th className="text-left px-4 py-2">Event</th>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-right px-4 py-2">Wert</th>
                <th className="text-left px-4 py-2">Quelle</th>
                <th className="text-left px-4 py-2">HTTP</th>
                <th className="text-left px-4 py-2">Fehler</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id.toString()}
                  className="border-t border-line/60 hover:bg-canvas/40"
                >
                  <td className="px-4 py-2">
                    {r.ok ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="size-4 text-danger" />
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted whitespace-nowrap">
                    {fmtWhen(r.sentAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="neutral" className="font-mono text-[11px]">
                      {r.eventName}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-ink truncate max-w-[220px]">
                    {r.userEmail || <span className="text-ink-muted italic">anonym</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {r.value
                      ? `${Number(r.value).toFixed(2)} ${r.currency ?? ""}`.trim()
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <Circle
                        className={cn(
                          "size-2 fill-current",
                          r.actionSource === "system_generated"
                            ? "text-brand"
                            : "text-emerald-500",
                        )}
                      />
                      {r.actionSource === "system_generated" ? "Server" : "Browser"}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                    {r.httpStatus ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-danger truncate max-w-[280px]">
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-5 text-[11px] text-ink-muted">
        Meta zeigt Events zusätzlich unter{" "}
        <a
          href="https://business.facebook.com/events_manager/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Events Manager
        </a>{" "}
        (Datenquelle 1780111992987971) mit Match-Qualität + Deduplikations-Info.
      </p>
    </>
  );
}
