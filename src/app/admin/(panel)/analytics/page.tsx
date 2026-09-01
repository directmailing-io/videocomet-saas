/**
 * Admin-Analytics: eigene Übersicht für videocomet.de (Marketing).
 * Zeigt: Live-Besucher, Kennzahlen heute/7d/30d, Top-Seiten, Top-Referrer,
 * Top-UTMs, letzte 200 Events. Kein Session-Replay, keine Heatmap —
 * bewusst schlank.
 */

import { desc, sql } from "drizzle-orm";
import { Activity, Radio, MousePointerClick, Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { siteEvents } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoRefresh } from "@/components/analytics/AutoRefresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadKpis() {
  const rows = await db.execute<{
    live_sessions: string;
    views_24h: string;
    views_7d: string;
    views_30d: string;
    sessions_24h: string;
    sessions_7d: string;
    sessions_30d: string;
    clicks_24h: string;
  }>(sql`
    SELECT
      (SELECT COUNT(DISTINCT session_id)::text FROM ${siteEvents}
        WHERE created_at > now() - interval '5 minutes') AS live_sessions,
      (SELECT COUNT(*)::text FROM ${siteEvents}
        WHERE event_name = 'page_view' AND created_at > now() - interval '24 hours') AS views_24h,
      (SELECT COUNT(*)::text FROM ${siteEvents}
        WHERE event_name = 'page_view' AND created_at > now() - interval '7 days') AS views_7d,
      (SELECT COUNT(*)::text FROM ${siteEvents}
        WHERE event_name = 'page_view' AND created_at > now() - interval '30 days') AS views_30d,
      (SELECT COUNT(DISTINCT session_id)::text FROM ${siteEvents}
        WHERE created_at > now() - interval '24 hours') AS sessions_24h,
      (SELECT COUNT(DISTINCT session_id)::text FROM ${siteEvents}
        WHERE created_at > now() - interval '7 days') AS sessions_7d,
      (SELECT COUNT(DISTINCT session_id)::text FROM ${siteEvents}
        WHERE created_at > now() - interval '30 days') AS sessions_30d,
      (SELECT COUNT(*)::text FROM ${siteEvents}
        WHERE event_name = 'click' AND created_at > now() - interval '24 hours') AS clicks_24h
  `);
  const first = (rows as unknown as Array<Record<string, string>>)[0] ?? {};
  return {
    liveSessions: Number(first.live_sessions ?? 0),
    views: {
      "24h": Number(first.views_24h ?? 0),
      "7d": Number(first.views_7d ?? 0),
      "30d": Number(first.views_30d ?? 0),
    },
    sessions: {
      "24h": Number(first.sessions_24h ?? 0),
      "7d": Number(first.sessions_7d ?? 0),
      "30d": Number(first.sessions_30d ?? 0),
    },
    clicks24h: Number(first.clicks_24h ?? 0),
  };
}

async function loadTopPaths() {
  const rows = await db
    .select({
      path: siteEvents.path,
      views: sql<string>`COUNT(*)::text`,
    })
    .from(siteEvents)
    .where(sql`${siteEvents.eventName} = 'page_view' AND ${siteEvents.createdAt} > now() - interval '7 days' AND ${siteEvents.path} IS NOT NULL`)
    .groupBy(siteEvents.path)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(15);
  return rows.map((r) => ({ path: r.path ?? "(leer)", views: Number(r.views) }));
}

async function loadTopReferrers() {
  const rows = await db
    .select({
      referrer: siteEvents.referrer,
      hits: sql<string>`COUNT(*)::text`,
    })
    .from(siteEvents)
    .where(sql`${siteEvents.eventName} = 'page_view' AND ${siteEvents.createdAt} > now() - interval '7 days' AND ${siteEvents.referrer} IS NOT NULL AND ${siteEvents.referrer} <> ''`)
    .groupBy(siteEvents.referrer)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(10);
  return rows.map((r) => ({
    referrer: r.referrer ?? "(direkt)",
    hits: Number(r.hits),
  }));
}

async function loadTopUtms() {
  const rows = await db
    .select({
      source: siteEvents.utmSource,
      medium: siteEvents.utmMedium,
      campaign: siteEvents.utmCampaign,
      hits: sql<string>`COUNT(*)::text`,
    })
    .from(siteEvents)
    .where(sql`${siteEvents.eventName} = 'page_view' AND ${siteEvents.createdAt} > now() - interval '30 days' AND ${siteEvents.utmSource} IS NOT NULL`)
    .groupBy(siteEvents.utmSource, siteEvents.utmMedium, siteEvents.utmCampaign)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(15);
  return rows.map((r) => ({
    source: r.source ?? "",
    medium: r.medium ?? "",
    campaign: r.campaign ?? "",
    hits: Number(r.hits),
  }));
}

async function loadTopClicks() {
  const rows = await db.execute<{ label: string; href: string; hits: string }>(sql`
    SELECT
      COALESCE(meta->>'label', '')::text AS label,
      COALESCE(meta->>'href', '')::text  AS href,
      COUNT(*)::text                     AS hits
    FROM ${siteEvents}
    WHERE event_name = 'click'
      AND created_at > now() - interval '7 days'
    GROUP BY 1, 2
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `);
  const list = (rows as unknown as Array<{ label: string; href: string; hits: string }>);
  return list.map((r) => ({
    label: r.label || "(ohne Text)",
    href: r.href || null,
    hits: Number(r.hits),
  }));
}

async function loadRecent() {
  return db
    .select({
      id: siteEvents.id,
      sessionId: siteEvents.sessionId,
      eventName: siteEvents.eventName,
      path: siteEvents.path,
      referrer: siteEvents.referrer,
      utmSource: siteEvents.utmSource,
      utmCampaign: siteEvents.utmCampaign,
      meta: siteEvents.meta,
      createdAt: siteEvents.createdAt,
    })
    .from(siteEvents)
    .orderBy(desc(siteEvents.createdAt))
    .limit(200);
}

function fmt(n: number) {
  return new Intl.NumberFormat("de-DE").format(n);
}
function fmtTime(d: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

export default async function AdminAnalyticsPage() {
  const [kpis, topPaths, topReferrers, topUtms, topClicks, recent] = await Promise.all([
    loadKpis(),
    loadTopPaths(),
    loadTopReferrers(),
    loadTopUtms(),
    loadTopClicks(),
    loadRecent(),
  ]);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Eigene Übersicht für videocomet.de — PageViews, Klicks, UTMs. Ohne Cookies, ohne Drittanbieter."
        actions={<AutoRefresh intervalMs={5000} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Radio className="size-4 text-ok" />
              Live jetzt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-ink">{fmt(kpis.liveSessions)}</p>
            <p className="mt-1 text-xs text-ink-muted">Sessions letzte 5 Min</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Activity className="size-4 text-brand-deep" />
              PageViews 24 h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-ink">{fmt(kpis.views["24h"])}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {fmt(kpis.sessions["24h"])} Sessions
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Activity className="size-4 text-brand-deep" />
              PageViews 7 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-ink">{fmt(kpis.views["7d"])}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {fmt(kpis.sessions["7d"])} Sessions
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <MousePointerClick className="size-4 text-brand-deep" />
              Klicks 24 h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-ink">{fmt(kpis.clicks24h)}</p>
            <p className="mt-1 text-xs text-ink-muted">Auf Links + Buttons</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top-Seiten (7 Tage)</CardTitle>
          </CardHeader>
          <CardContent>
            {topPaths.length === 0 ? (
              <p className="text-sm italic text-ink-muted">Noch keine Aufrufe.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {topPaths.map((p) => (
                  <li key={p.path} className="grid grid-cols-[1fr_auto] gap-4 py-1.5 text-sm">
                    <span className="truncate font-mono text-xs text-ink" title={p.path}>
                      {p.path}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{fmt(p.views)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4 text-brand-deep" />
              Top-Herkunft (7 Tage)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topReferrers.length === 0 ? (
              <p className="text-sm italic text-ink-muted">Noch keine Herkunft aufgezeichnet.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {topReferrers.map((r, i) => (
                  <li
                    key={`${r.referrer}-${i}`}
                    className="grid grid-cols-[1fr_auto] gap-4 py-1.5 text-sm"
                  >
                    <span className="truncate text-xs text-ink" title={r.referrer}>
                      {r.referrer}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{fmt(r.hits)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top-UTM-Kampagnen (30 Tage)</CardTitle>
          </CardHeader>
          <CardContent>
            {topUtms.length === 0 ? (
              <p className="text-sm italic text-ink-muted">Noch keine UTM-Zugriffe.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {topUtms.map((u, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto] gap-4 py-1.5 text-xs">
                    <span className="truncate text-ink">
                      <span className="font-semibold">{u.source}</span>
                      {u.medium && ` · ${u.medium}`}
                      {u.campaign && ` · ${u.campaign}`}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{fmt(u.hits)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Meist-geklickte Elemente (7 Tage)</CardTitle>
          </CardHeader>
          <CardContent>
            {topClicks.length === 0 ? (
              <p className="text-sm italic text-ink-muted">Noch keine Klicks aufgezeichnet.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {topClicks.map((c, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto] gap-4 py-1.5 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="text-ink">{c.label}</span>
                      {c.href && (
                        <span className="ml-2 text-ink-muted" title={c.href}>
                          → {c.href.slice(0, 40)}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{fmt(c.hits)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Letzte 200 Events</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm italic text-ink-muted">Noch keine Events geloggt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line-soft text-left text-ink-muted">
                    <th className="py-2 pr-3">Zeit</th>
                    <th className="py-2 pr-3">Event</th>
                    <th className="py-2 pr-3">Pfad</th>
                    <th className="py-2 pr-3">UTM/Meta</th>
                    <th className="py-2">Session</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={String(e.id)} className="border-b border-line-soft/50">
                      <td className="py-1.5 pr-3 tabular-nums text-ink-muted">
                        {fmtTime(e.createdAt)}
                      </td>
                      <td className="py-1.5 pr-3 text-ink">{e.eventName}</td>
                      <td className="py-1.5 pr-3 font-mono text-ink" title={e.path ?? ""}>
                        {(e.path ?? "").slice(0, 40)}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-muted">
                        {e.utmSource && `utm=${e.utmSource}${e.utmCampaign ? "/" + e.utmCampaign : ""} `}
                        {(e.meta as { label?: string })?.label
                          ? `„${((e.meta as { label?: string }).label ?? "").slice(0, 40)}"`
                          : ""}
                      </td>
                      <td className="py-1.5 font-mono text-ink-muted">
                        {e.sessionId.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
