"use client";

/**
 * Credit-History — volle Transparenz der Credit-Bewegungen.
 *
 * Fuer jede Aufladung: Datum, Betrag, Stripe-Payment-Referenz.
 * Fuer jeden Verbrauch: Kampagne + Runde + Lead — direkt verlinkt zum Run.
 * Fuer Admin-Adjustments: Admin-Email + Grund.
 *
 * Pagination via Cursor. Filter-Chips pro Kind.
 */

import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Kind =
  | "topup"
  | "video_charge"
  | "admin_adjust"
  | "promo_grant"
  | "email_charge"
  | "email_refund";

interface HistoryItem {
  id: string;
  kind: Kind;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  stripeRef: string | null;
  createdAt: string;
  context:
    | {
        leadId: string | null;
        leadRowIndex: number | null;
        runId: string | null;
        runName: string | null;
        campaignId: string | null;
        campaignName: string | null;
      }
    | { adminEmail: string | null }
    | {
        blastId: string;
        campaignId: string | null;
        campaignName: string | null;
      }
    | null;
}

const KIND_LABEL: Record<Kind, string> = {
  topup: "Credits gekauft",
  video_charge: "Video generiert",
  admin_adjust: "Admin-Korrektur",
  promo_grant: "Bonus",
  email_charge: "E-Mail-Versand gestartet",
  email_refund: "E-Mail-Credits erstattet",
};

type FilterId = Kind | "all" | "email";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "video_charge", label: "Videos" },
  { id: "email", label: "E-Mail" },
  { id: "topup", label: "Käufe" },
  { id: "admin_adjust", label: "Korrekturen" },
  { id: "promo_grant", label: "Boni" },
];

/** Refund-Grund aus dem Reason-Suffix ("…:cancel" | "…:failures"). */
function emailRefundLabel(reason: string | null): string {
  if (reason?.endsWith(":cancel")) return "Erstattung nach Abbruch des Versands";
  if (reason?.endsWith(":failures"))
    return "Erstattung für nicht zustellbare E-Mails";
  return "Erstattung nicht versendeter E-Mails";
}

export function CreditHistory() {
  const [items, setItems] = React.useState<HistoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(
    async (nextCursor: string | null, reset: boolean, kindFilter: FilterId) => {
      const params = new URLSearchParams({ limit: "25" });
      if (nextCursor) params.set("cursor", nextCursor);
      if (kindFilter !== "all") params.set("kind", kindFilter);
      const res = await fetch(`/api/billing/history?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        items: HistoryItem[];
        nextCursor: string | null;
      };
      setItems((prev) => (reset ? body.items : [...prev, ...body.items]));
      setCursor(body.nextCursor);
    },
    [],
  );

  React.useEffect(() => {
    setLoading(true);
    void load(null, true, filter).finally(() => setLoading(false));
  }, [filter, load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    await load(cursor, false, filter);
    setLoadingMore(false);
  }

  return (
    <div className="rounded-squircle-md bg-surface shadow-card">
      <div className="p-6 border-b border-line-soft">
        <h3 className="text-base font-semibold">Credit-Verlauf</h3>
        <p className="text-xs text-ink-muted mt-1">
          Vollständige Historie aller Aufladungen, Video- und E-Mail-Verbräuche
          mit Klartext-Kontext.
        </p>
        <div className="flex items-center gap-1.5 mt-4 flex-wrap">
          <Filter className="size-3.5 text-ink-muted" />
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "text-xs font-semibold rounded-full px-3 py-1.5 transition-colors",
                filter === f.id
                  ? "bg-brand text-white"
                  : "bg-surface-soft text-ink-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin inline mr-2" />
          Lade …
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-ink-muted">
          Noch keine Bewegungen in dieser Kategorie.
        </div>
      ) : (
        <>
          <div className="divide-y divide-line">
            {items.map((tx) => (
              <div key={tx.id} className="p-4 flex items-start gap-4">
                <div
                  className={cn(
                    "shrink-0 size-8 rounded-full flex items-center justify-center",
                    tx.delta > 0
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  {tx.delta > 0 ? (
                    <ArrowUpRight className="size-4" />
                  ) : (
                    <ArrowDownRight className="size-4" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{KIND_LABEL[tx.kind]}</div>

                  {/* Video-Charge: verlinkt zu Run */}
                  {tx.kind === "video_charge" && tx.context && "runId" in tx.context && tx.context.runId ? (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {tx.context.campaignName ? (
                        <>
                          Kampagne{" "}
                          <Link
                            href={`/kampagnen/${tx.context.campaignId}`}
                            className="text-brand hover:underline"
                          >
                            {tx.context.campaignName}
                          </Link>
                          {" · "}
                          <Link
                            href={`/kampagnen/${tx.context.campaignId}/runs/${tx.context.runId}`}
                            className="text-brand hover:underline inline-flex items-center gap-0.5"
                          >
                            {tx.context.runName ?? "Runde"}
                            <ExternalLink className="size-3" />
                          </Link>
                          {tx.context.leadRowIndex != null && (
                            <> · Lead #{(tx.context.leadRowIndex ?? 0) + 1}</>
                          )}
                        </>
                      ) : (
                        <>Runde nicht mehr verfügbar (evtl. gelöscht)</>
                      )}
                    </div>
                  ) : tx.kind === "video_charge" ? (
                    <div className="text-xs text-ink-muted mt-0.5">
                      Runde/Kampagne wurde gelöscht
                    </div>
                  ) : null}

                  {/* E-Mail-Charge/-Refund: verlinkt zum Versand */}
                  {(tx.kind === "email_charge" || tx.kind === "email_refund") && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {tx.context && "blastId" in tx.context && tx.context.campaignId ? (
                        <>
                          Kampagne{" "}
                          <Link
                            href={`/kampagnen/${tx.context.campaignId}`}
                            className="text-brand hover:underline"
                          >
                            {tx.context.campaignName ?? "Kampagne"}
                          </Link>
                          {" · "}
                          <Link
                            href={`/kampagnen/${tx.context.campaignId}/email/${tx.context.blastId}`}
                            className="text-brand hover:underline inline-flex items-center gap-0.5"
                          >
                            Versand öffnen
                            <ExternalLink className="size-3" />
                          </Link>
                          {" · "}
                        </>
                      ) : (
                        <>Versand wurde gelöscht · </>
                      )}
                      {tx.kind === "email_charge"
                        ? "1 Credit = 10 E-Mails (aufgerundet)"
                        : emailRefundLabel(tx.reason)}
                    </div>
                  )}

                  {/* Topup: Stripe-Ref */}
                  {tx.kind === "topup" && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      Zahlung via Stripe
                      {tx.stripeRef && (
                        <span className="font-mono text-[10px] ml-1">
                          · {tx.stripeRef.slice(0, 20)}
                          {tx.stripeRef.length > 20 && "…"}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Admin-Adjust: Grund + Admin */}
                  {tx.kind === "admin_adjust" && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {tx.context && "adminEmail" in tx.context && tx.context.adminEmail && (
                        <>durch {tx.context.adminEmail} · </>
                      )}
                      {tx.reason ?? "kein Grund angegeben"}
                    </div>
                  )}

                  {tx.kind === "promo_grant" && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {tx.reason ?? "Willkommensbonus"}
                    </div>
                  )}

                  <div className="text-[11px] text-ink-muted mt-1">
                    {new Date(tx.createdAt).toLocaleString("de-DE")}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      tx.delta > 0 ? "text-emerald-600" : "text-ink",
                    )}
                  >
                    {tx.delta > 0 ? "+" : ""}
                    {tx.delta}
                  </div>
                  <div className="text-[11px] text-ink-muted tabular-nums">
                    Stand: {tx.balanceAfter}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {cursor && (
            <div className="p-4 border-t border-line text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                loading={loadingMore}
              >
                Mehr laden
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
