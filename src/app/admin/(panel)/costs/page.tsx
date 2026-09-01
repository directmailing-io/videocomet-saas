/**
 * Admin-Kosten-Übersicht: was uns externe APIs pro Video wirklich kosten
 * (Fish TTS + sync.so Lipsync — pro Job-Ende geloggt via logCostEvent).
 *
 * Diese Seite ist rein informell und beeinflusst NICHTS am Credit-System
 * oder Billing. Ziel: sehen, wo die Marge pro Kampagne/Lead liegt, und
 * Ausrutscher (z.B. sync.so-Job mit sehr langem Segment) früh erkennen.
 */

import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Wallet, Zap, MicVocal } from "lucide-react";
import { db } from "@/lib/db";
import {
  campaigns,
  costEvents,
  creditTransactions,
  users,
} from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMicroEurCompact } from "@/lib/costs";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  intro_tts: "Fish TTS (KI-Begrüßung)",
  intro_lipsync: "sync.so Lipsync (KI-Begrüßung)",
  other: "Sonstiges",
};

async function loadTotals() {
  const rows = await db.execute<{
    window: string;
    kind: string;
    total: string;
  }>(sql`
    SELECT
      CASE
        WHEN ${costEvents.createdAt} > now() - interval '24 hours' THEN '24h'
        WHEN ${costEvents.createdAt} > now() - interval '7 days'   THEN '7d'
        ELSE '30d'
      END AS window,
      ${costEvents.kind} AS kind,
      SUM(${costEvents.amountMicroEur})::text AS total
    FROM ${costEvents}
    WHERE ${costEvents.createdAt} > now() - interval '30 days'
    GROUP BY 1, 2
  `);
  const map: Record<"24h" | "7d" | "30d", Record<string, number>> = {
    "24h": {},
    "7d": {},
    "30d": {},
  };
  const rowList = (rows as unknown as Array<{ window: string; kind: string; total: string }>);
  for (const r of rowList) {
    const win = r.window as "24h" | "7d" | "30d";
    map[win][r.kind] = Number(r.total);
  }
  // 7d = 24h + 7d-only rows; 30d = alles.
  const kinds = new Set<string>();
  (["24h", "7d", "30d"] as const).forEach((w) => {
    Object.keys(map[w]).forEach((k) => kinds.add(k));
  });
  const acc: Record<"24h" | "7d" | "30d", Record<string, number>> = {
    "24h": {},
    "7d": {},
    "30d": {},
  };
  Array.from(kinds).forEach((k) => {
    const c24 = map["24h"][k] ?? 0;
    const c7 = map["7d"][k] ?? 0;
    const c30 = map["30d"][k] ?? 0;
    acc["24h"][k] = c24;
    acc["7d"][k] = c24 + c7;
    acc["30d"][k] = c24 + c7 + c30;
  });
  return acc;
}

async function loadTopLeads() {
  const rows = await db
    .select({
      leadId: costEvents.leadId,
      total: sql<string>`SUM(${costEvents.amountMicroEur})::text`,
    })
    .from(costEvents)
    .where(sql`${costEvents.leadId} IS NOT NULL AND ${costEvents.createdAt} > now() - interval '30 days'`)
    .groupBy(costEvents.leadId)
    .orderBy(sql`SUM(${costEvents.amountMicroEur}) DESC`)
    .limit(10);
  return rows.map((r) => ({
    leadId: r.leadId!,
    total: Number(r.total),
  }));
}

async function loadCampaignMargin() {
  // Verbrauchte Credits pro Kampagne (video_charge, negativer Delta).
  const creditRows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      userEmail: users.email,
      creditsSpent: sql<string>`ABS(SUM(${creditTransactions.delta}))::text`,
    })
    .from(creditTransactions)
    .innerJoin(campaigns, sql`${creditTransactions.runId} IN (SELECT id FROM runs WHERE runs.campaign_id = ${campaigns.id})`)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(sql`${creditTransactions.kind} = 'video_charge' AND ${creditTransactions.createdAt} > now() - interval '30 days'`)
    .groupBy(campaigns.id, campaigns.name, users.email)
    .orderBy(desc(sql`ABS(SUM(${creditTransactions.delta}))`))
    .limit(15);

  const campaignIds = creditRows.map((r) => r.campaignId);
  const costMap = new Map<string, number>();
  if (campaignIds.length > 0) {
    const costRows = await db
      .select({
        campaignId: costEvents.campaignId,
        total: sql<string>`SUM(${costEvents.amountMicroEur})::text`,
      })
      .from(costEvents)
      .where(
        sql`${inArray(costEvents.campaignId, campaignIds)} AND ${costEvents.createdAt} > now() - interval '30 days'`,
      )
      .groupBy(costEvents.campaignId);
    for (const r of costRows) {
      if (r.campaignId) costMap.set(r.campaignId, Number(r.total));
    }
  }

  return creditRows.map((r) => {
    const creditsSpent = Number(r.creditsSpent);
    const revenueMicroEur = creditsSpent * 1_000_000; // 1 Credit = 1 €
    const costMicroEur = costMap.get(r.campaignId) ?? 0;
    return {
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? "(ohne Name)",
      userEmail: r.userEmail,
      creditsSpent,
      revenueMicroEur,
      costMicroEur,
      marginMicroEur: revenueMicroEur - costMicroEur,
    };
  });
}

export default async function AdminCostsPage() {
  const [totals, topLeads, campaignMargin] = await Promise.all([
    loadTotals(),
    loadTopLeads(),
    loadCampaignMargin(),
  ]);

  const windowsList: Array<"24h" | "7d" | "30d"> = ["24h", "7d", "30d"];
  const totalByWindow = (w: "24h" | "7d" | "30d") =>
    Object.values(totals[w]).reduce((s, v) => s + v, 0);

  return (
    <>
      <PageHeader
        title="Kosten"
        subtitle="Was uns externe APIs pro Video kosten — Fish TTS + sync.so Lipsync werden pro Job-Ende geloggt."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {windowsList.map((w) => (
          <Card key={w}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <Wallet className="size-4" />
                Kosten {w === "24h" ? "letzte 24 h" : w === "7d" ? "letzte 7 Tage" : "letzte 30 Tage"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-ink">
                {formatMicroEurCompact(totalByWindow(w))}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                {Object.entries(totals[w]).map(([kind, v]) => (
                  <li key={kind} className="flex justify-between">
                    <span className="truncate">{KIND_LABEL[kind] ?? kind}</span>
                    <span className="tabular-nums">{formatMicroEurCompact(v)}</span>
                  </li>
                ))}
                {Object.keys(totals[w]).length === 0 && (
                  <li className="italic">Noch keine Kosten geloggt.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-brand-deep" />
              Marge pro Kampagne (letzte 30 Tage)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {campaignMargin.length === 0 ? (
              <p className="text-sm text-ink-muted italic">
                Noch keine bezahlten Videos in den letzten 30 Tagen.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {campaignMargin.map((c) => (
                  <li key={c.campaignId} className="grid grid-cols-[1fr_auto] gap-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {c.campaignName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {c.userEmail} · {c.creditsSpent} Credits verbraucht
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="text-sm font-semibold text-ink">
                        {formatMicroEurCompact(c.marginMicroEur)}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatMicroEurCompact(c.revenueMicroEur)} − {formatMicroEurCompact(c.costMicroEur)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MicVocal className="size-4 text-brand-deep" />
              Teuerste Leads (letzte 30 Tage)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topLeads.length === 0 ? (
              <p className="text-sm text-ink-muted italic">
                Noch keine Lead-Kosten geloggt.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {topLeads.map((l) => (
                  <li
                    key={l.leadId}
                    className="grid grid-cols-[1fr_auto] gap-4 py-2 text-sm"
                  >
                    <Link
                      href={`/admin/users?leadId=${l.leadId}`}
                      className="truncate font-mono text-xs text-brand-deep hover:underline"
                      title={l.leadId}
                    >
                      {l.leadId.slice(0, 8)}…{l.leadId.slice(-4)}
                    </Link>
                    <span className="tabular-nums text-ink">
                      {formatMicroEurCompact(l.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 rounded-squircle-md bg-surface p-5 shadow-card">
        <h3 className="mb-2 text-sm font-semibold text-ink">Preis-Annahmen</h3>
        <ul className="space-y-1 text-xs text-ink-muted">
          <li>Fish Audio s2.1-pro: 15 € / 1M Zeichen (~0,2 Cent pro KI-Begrüßung)</li>
          <li>sync.so lipsync-2: 0,06 € pro Sekunde generiertes Video (typisch 30–60 Cent pro Intro)</li>
          <li>Bunny-Storage/-CDN + Server-Fixkosten sind NICHT enthalten (fließen als Aggregat in die Monatsrechnung).</li>
        </ul>
      </div>
    </>
  );
}
