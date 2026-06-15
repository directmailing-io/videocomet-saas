"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ShareEventRow,
  ShareLeadRow,
  ShareRemovedLeadRow,
} from "@/lib/db/queries/campaign-shares";
import { ShareLeadsTab } from "./_components/share-leads-tab";
import { ShareLiveTrackingTab } from "./_components/share-live-tracking-tab";
import { ShareEngagementTab } from "./_components/share-engagement-tab";
import { ShareRemovedTab } from "./_components/share-removed-tab";

// Serialisierte Variante des Lead-Rows: Dates → ISO-Strings, weil das Server-
// Component → Client-Component-Boundary nur JSON-fähige Werte erlaubt.
export interface SerializableShareLead
  extends Omit<
    ShareLeadRow,
    "firstViewedAt" | "lastViewedAt" | "lastCtaAt" | "createdAt"
  > {
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  lastCtaAt: string | null;
  createdAt: string;
}

export interface SerializableShareEvent
  extends Omit<ShareEventRow, "ts"> {
  ts: string;
}

// Removed-Lead-Row serialisiert: `removedAt` als ISO-String über die
// Server→Client-Boundary. Reason / Detail bleiben strukturell identisch.
export interface SerializableShareRemovedLead
  extends Omit<ShareRemovedLeadRow, "removedAt"> {
  removedAt: string;
}

interface ShareDashboardProps {
  token: string;
  campaignName: string;
  initialLeads: ShareLeadRow[];
  initialEvents: ShareEventRow[];
  initialRemoved: ShareRemovedLeadRow[];
  /**
   * Bereits zusammengesetzte URL-Basis pro Lead. Vanity-Host → `https://host`
   * (Middleware rewrited `/<slug>`); Default → `${appUrl}/v`. In beiden
   * Fällen baut der Konsument `${leadBaseUrl}/${slug}`.
   */
  leadBaseUrl: string;
}

type TabKey = "leads" | "live" | "engagement" | "removed";

function isTabKey(value: string | null | undefined): value is TabKey {
  return (
    value === "leads" ||
    value === "live" ||
    value === "engagement" ||
    value === "removed"
  );
}

/**
 * Top-Level Client-Komponente für die authentifizierte Public-Share-Sicht.
 *
 * Tabs sind URL-sync'd via `?tab=` — das macht Direkt-Links sharebar (sofern
 * der Empfänger das Passwort kennt) und Back/Forward bleibt verlässlich.
 * Initiales Datenset kommt SSR — die Live-Tab pollt zusätzlich für Updates.
 */
export function ShareDashboard({
  token,
  campaignName,
  initialLeads,
  initialEvents,
  initialRemoved,
  leadBaseUrl,
}: ShareDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dates → ISO-Strings einmalig vor allen Renders. So bleibt der Tab-State
  // pure JSON-safe und die in-memory Filter-/Sortier-Berechnungen müssen nicht
  // bei jedem Tab-Wechsel die Date-Konstruktoren neu auswerten.
  const leads: SerializableShareLead[] = React.useMemo(
    () =>
      initialLeads.map((l) => ({
        ...l,
        firstViewedAt: l.firstViewedAt ? l.firstViewedAt.toISOString() : null,
        lastViewedAt: l.lastViewedAt ? l.lastViewedAt.toISOString() : null,
        lastCtaAt: l.lastCtaAt ? l.lastCtaAt.toISOString() : null,
        createdAt: l.createdAt.toISOString(),
      })),
    [initialLeads],
  );

  const events: SerializableShareEvent[] = React.useMemo(
    () =>
      initialEvents.map((e) => ({
        ...e,
        ts: e.ts.toISOString(),
      })),
    [initialEvents],
  );

  const removed: SerializableShareRemovedLead[] = React.useMemo(
    () =>
      initialRemoved.map((r) => ({
        ...r,
        removedAt: r.removedAt.toISOString(),
      })),
    [initialRemoved],
  );

  const tabFromUrl: TabKey = (() => {
    const raw = searchParams?.get("tab") ?? null;
    return isTabKey(raw) ? raw : "leads";
  })();

  const onTabChange = React.useCallback(
    (next: string) => {
      const value = isTabKey(next) ? next : "leads";
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (value === "leads") params.delete("tab");
      else params.set("tab", value);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink truncate">
            {campaignName}
          </h1>
          <p className="text-sm text-ink-muted">
            {leads.length.toLocaleString("de-DE")} Leads insgesamt
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted border border-line px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Geteilte Ansicht (read-only)
        </span>
      </header>

      <Tabs value={tabFromUrl} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="live">Live-Tracking</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="removed">
            Aussortiert ({removed.length.toLocaleString("de-DE")})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <ShareLeadsTab leads={leads} leadBaseUrl={leadBaseUrl} />
        </TabsContent>

        <TabsContent value="live">
          <ShareLiveTrackingTab
            token={token}
            initialEvents={events}
            leadBaseUrl={leadBaseUrl}
          />
        </TabsContent>

        <TabsContent value="engagement">
          <ShareEngagementTab
            leads={leads}
            leadBaseUrl={leadBaseUrl}
            campaignName={campaignName}
          />
        </TabsContent>

        <TabsContent value="removed">
          <ShareRemovedTab leads={removed} leadBaseUrl={leadBaseUrl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Shared time/date helpers ─────────────────────────────────────────────────

/** Tagesgenaue + sekundengenaue Zeitformatierung für die Public-Share-UI. */
export function formatDateTimeDE(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

/** Nur HH:mm:ss. Für die kompakte rechte Spalte des Live-Feeds. */
export function formatTimeDE(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/** Kompaktes „vor 12 Sekunden / vor 3 Minuten / vor 2 Std" — kein Datum. */
export function formatRelativeDE(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 10_000) return "gerade eben";
  if (ms < 60_000) return `vor ${Math.floor(ms / 1000)} Sekunden`;
  if (ms < 3_600_000) return `vor ${Math.floor(ms / 60_000)} Minuten`;
  if (ms < 86_400_000) return `vor ${Math.floor(ms / 3_600_000)} Std`;
  return `vor ${Math.floor(ms / 86_400_000)} Tg.`;
}
