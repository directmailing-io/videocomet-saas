/**
 * Admin-Kosten-Übersicht: zeigt einfach, was wir an externen API-Kosten
 * verbrennen. Keine Marge, keine Auslegung — nur Preise-Referenz und
 * tageweise Kostenaufstellung.
 *
 * Preise sollten monatlich verifiziert werden (Fish/sync.so-Anbieter-
 * Websites) und danach in `src/lib/costs.ts` aktualisiert werden.
 */

import { desc, sql } from "drizzle-orm";
import { ExternalLink, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { costEvents, campaigns, leads } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatMicroEurCompact,
  FISH_TTS_MICRO_EUR_PER_CHAR,
  SYNCSO_MICRO_EUR_PER_SECOND,
  INFRA_MONTHLY_MICRO_EUR,
  INFRA_COSTS_LAST_CHECKED,
} from "@/lib/costs";
import { AutoRefresh } from "@/components/analytics/AutoRefresh";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  intro_tts: "Fish TTS (KI-Begrüßung)",
  intro_lipsync: "sync.so Lipsync (KI-Begrüßung)",
  other: "Sonstiges",
};

const PRICE_LAST_CHECKED = "2026-09-01";

async function loadTotals() {
  const rows = await db
    .select({
      kind: costEvents.kind,
      today: sql<string>`COALESCE(SUM(CASE WHEN ${costEvents.createdAt} > now() - interval '24 hours' THEN ${costEvents.amountMicroEur} ELSE 0 END), 0)::text`,
      d7: sql<string>`COALESCE(SUM(CASE WHEN ${costEvents.createdAt} > now() - interval '7 days' THEN ${costEvents.amountMicroEur} ELSE 0 END), 0)::text`,
      d30: sql<string>`COALESCE(SUM(CASE WHEN ${costEvents.createdAt} > now() - interval '30 days' THEN ${costEvents.amountMicroEur} ELSE 0 END), 0)::text`,
    })
    .from(costEvents)
    .where(sql`${costEvents.createdAt} > now() - interval '30 days'`)
    .groupBy(costEvents.kind);

  const totals = { today: 0, d7: 0, d30: 0 };
  const byKind: Record<string, { today: number; d7: number; d30: number }> = {};
  for (const r of rows) {
    const today = Number(r.today);
    const d7 = Number(r.d7);
    const d30 = Number(r.d30);
    totals.today += today;
    totals.d7 += d7;
    totals.d30 += d30;
    byKind[r.kind] = { today, d7, d30 };
  }
  return { totals, byKind };
}

async function loadDailyBreakdown() {
  const rows = await db.execute<{ day: string; kind: string; total: string }>(sql`
    SELECT
      to_char(date_trunc('day', ${costEvents.createdAt}), 'YYYY-MM-DD') AS day,
      ${costEvents.kind} AS kind,
      SUM(${costEvents.amountMicroEur})::text AS total
    FROM ${costEvents}
    WHERE ${costEvents.createdAt} > now() - interval '30 days'
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2
  `);
  const list = rows as unknown as Array<{ day: string; kind: string; total: string }>;
  const map = new Map<string, Record<string, number>>();
  for (const r of list) {
    if (!map.has(r.day)) map.set(r.day, {});
    map.get(r.day)![r.kind] = Number(r.total);
  }
  return Array.from(map.entries()).map(([day, kinds]) => ({
    day,
    kinds,
    total: Object.values(kinds).reduce((s, v) => s + v, 0),
  }));
}

async function loadRecentEvents() {
  return db
    .select({
      id: costEvents.id,
      kind: costEvents.kind,
      amountMicroEur: costEvents.amountMicroEur,
      meta: costEvents.meta,
      createdAt: costEvents.createdAt,
      leadId: costEvents.leadId,
      leadRowIndex: leads.rowIndex,
      leadEmail: leads.normalizedEmail,
      campaignId: costEvents.campaignId,
      campaignName: campaigns.name,
    })
    .from(costEvents)
    .leftJoin(leads, sql`${leads.id} = ${costEvents.leadId}`)
    .leftJoin(campaigns, sql`${campaigns.id} = ${costEvents.campaignId}`)
    .orderBy(desc(costEvents.createdAt))
    .limit(200);
}

function fmtTime(d: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
function fmtDay(day: string) {
  const d = new Date(day);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
  }).format(d);
}

export default async function AdminCostsPage() {
  const [{ totals, byKind }, daily, recent] = await Promise.all([
    loadTotals(),
    loadDailyBreakdown(),
    loadRecentEvents(),
  ]);
  const kindKeys = Array.from(new Set(daily.flatMap((d) => Object.keys(d.kinds))));

  return (
    <>
      <PageHeader
        title="Kosten"
        subtitle={`Was externe APIs pro Video kosten. Preise Stand ${PRICE_LAST_CHECKED} — bitte monatlich prüfen.`}
        actions={<AutoRefresh intervalMs={10000} />}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Wallet className="size-4" />
              Kosten heute
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-ink">
              {formatMicroEurCompact(totals.today)}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {Object.entries(byKind).map(([kind, v]) => (
                <li key={kind} className="flex justify-between">
                  <span className="truncate">{KIND_LABEL[kind] ?? kind}</span>
                  <span className="tabular-nums">{formatMicroEurCompact(v.today)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Wallet className="size-4" />
              Letzte 7 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-ink">
              {formatMicroEurCompact(totals.d7)}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {Object.entries(byKind).map(([kind, v]) => (
                <li key={kind} className="flex justify-between">
                  <span className="truncate">{KIND_LABEL[kind] ?? kind}</span>
                  <span className="tabular-nums">{formatMicroEurCompact(v.d7)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <Wallet className="size-4" />
              Letzte 30 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-ink">
              {formatMicroEurCompact(totals.d30)}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {Object.entries(byKind).map(([kind, v]) => (
                <li key={kind} className="flex justify-between">
                  <span className="truncate">{KIND_LABEL[kind] ?? kind}</span>
                  <span className="tabular-nums">{formatMicroEurCompact(v.d30)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-squircle-md bg-surface p-5 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-ink">
            Fixkosten pro Monat (Schätzung, Stand {INFRA_COSTS_LAST_CHECKED})
          </h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Hetzner CX53 (Server + Backups)</span>
              <span className="tabular-nums font-semibold text-ink">
                {formatMicroEurCompact(INFRA_MONTHLY_MICRO_EUR.server)}
              </span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Bunny (Stream + Storage + CDN)</span>
              <span className="tabular-nums font-semibold text-ink">
                ~{formatMicroEurCompact(INFRA_MONTHLY_MICRO_EUR.bunny)}
              </span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-ink-muted">Resend (System-Mails, freier Tarif)</span>
              <span className="tabular-nums font-semibold text-ink">
                {formatMicroEurCompact(INFRA_MONTHLY_MICRO_EUR.resend)}
              </span>
            </li>
            <li className="mt-2 flex items-baseline justify-between border-t border-line-soft pt-2">
              <span className="font-semibold text-ink">Gesamt Fixkosten</span>
              <span className="tabular-nums font-bold text-ink">
                {formatMicroEurCompact(
                  INFRA_MONTHLY_MICRO_EUR.server +
                    INFRA_MONTHLY_MICRO_EUR.bunny +
                    INFRA_MONTHLY_MICRO_EUR.resend,
                )}
              </span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            Fixkosten laufen unabhängig vom Video-Volumen. Bunny ist geschätzt —
            exakte Zahl im Bunny-Portal. Anpassen in{" "}
            <code>src/lib/costs.ts</code>.
          </p>
        </div>

        <div className="rounded-squircle-md bg-surface p-5 shadow-card">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          Preis-Referenz externe APIs (Stand {PRICE_LAST_CHECKED})
        </h3>
        <ul className="space-y-1 text-xs text-ink-muted">
          <li>
            <strong>Fish Audio s2.1-pro:</strong> 15 € pro 1 Mio Zeichen (=
            {" "}
            {FISH_TTS_MICRO_EUR_PER_CHAR} Micro-EUR pro Zeichen) —{" "}
            <a
              href="https://fish.audio/pricing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-deep hover:underline"
            >
              prüfen <ExternalLink className="size-3" />
            </a>
          </li>
          <li>
            <strong>sync.so lipsync-2:</strong> 0,06 € pro Sekunde generiertes
            Video (= {SYNCSO_MICRO_EUR_PER_SECOND} Micro-EUR pro Sekunde) —{" "}
            <a
              href="https://sync.so/pricing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-deep hover:underline"
            >
              prüfen <ExternalLink className="size-3" />
            </a>
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          Nach Änderung: Werte in <code>src/lib/costs.ts</code> anpassen und{" "}
          <code>PRICE_LAST_CHECKED</code> auf dieser Seite hochsetzen.
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Weitere API-Kosten pro Video gibt es aktuell nicht (kein OpenAI /
          Anthropic / Azure). Google Docs / Sheets / Fonts sind kostenlos.
        </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Kosten pro Tag (letzte 30 Tage)</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.length === 0 ? (
            <p className="text-sm italic text-ink-muted">
              Noch keine Kosten geloggt. Sobald jemand ein Video mit KI-
              Begrüßung generiert, tauchen hier Zeilen auf.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs text-ink-muted">
                    <th className="py-2 pr-4">Tag</th>
                    {kindKeys.map((k) => (
                      <th key={k} className="py-2 pr-4 text-right">
                        {KIND_LABEL[k] ?? k}
                      </th>
                    ))}
                    <th className="py-2 text-right">Gesamt</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((row) => (
                    <tr key={row.day} className="border-b border-line-soft/50">
                      <td className="py-1.5 pr-4 text-ink">{fmtDay(row.day)}</td>
                      {kindKeys.map((k) => (
                        <td key={k} className="py-1.5 pr-4 text-right tabular-nums text-ink">
                          {formatMicroEurCompact(row.kinds[k] ?? 0)}
                        </td>
                      ))}
                      <td className="py-1.5 text-right font-semibold tabular-nums text-ink">
                        {formatMicroEurCompact(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Letzte 200 Kosten-Events</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm italic text-ink-muted">Noch nichts geloggt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line-soft text-left text-ink-muted">
                    <th className="py-2 pr-3">Zeit</th>
                    <th className="py-2 pr-3">Art</th>
                    <th className="py-2 pr-3">Details</th>
                    <th className="py-2 pr-3">Lead</th>
                    <th className="py-2 pr-3">Kampagne</th>
                    <th className="py-2 text-right">Kosten</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => {
                    const meta = (e.meta as Record<string, unknown>) ?? {};
                    const details =
                      e.kind === "intro_tts"
                        ? `${meta.chars ?? "?"} Zeichen`
                        : e.kind === "intro_lipsync"
                          ? `${meta.seconds ?? "?"} s Video`
                          : JSON.stringify(meta).slice(0, 60);
                    const leadName =
                      e.leadEmail ||
                      (e.leadRowIndex != null ? `#${e.leadRowIndex}` : "") ||
                      "–";
                    return (
                      <tr key={String(e.id)} className="border-b border-line-soft/50">
                        <td className="py-1.5 pr-3 tabular-nums text-ink-muted">
                          {fmtTime(e.createdAt)}
                        </td>
                        <td className="py-1.5 pr-3 text-ink">
                          {KIND_LABEL[e.kind] ?? e.kind}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{details}</td>
                        <td className="py-1.5 pr-3 truncate text-ink" title={leadName}>
                          {leadName}
                        </td>
                        <td className="py-1.5 pr-3 truncate text-ink" title={e.campaignName ?? ""}>
                          {e.campaignName ?? "–"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-ink">
                          {formatMicroEurCompact(e.amountMicroEur)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
