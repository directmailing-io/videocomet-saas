"use client";

/**
 * Rechnungen-Liste — alle Stripe-Invoices direkt in der App.
 *
 * Fuer jede Rechnung: Nummer, Datum, Line-Items (was war drin), Netto,
 * MwSt, Brutto, Status-Badge, PDF-Download.
 */

import * as React from "react";
import {
  Loader2,
  Download,
  ExternalLink,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  createdAt: string | null;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  lines: Array<{ description: string; amount: number; quantity: number }>;
}

const STATUS_MAP: Record<
  string,
  { label: string; icon: React.ReactNode; className: string }
> = {
  paid: {
    label: "Bezahlt",
    icon: <CheckCircle2 className="size-3" />,
    className: "bg-ok-soft text-ok",
  },
  open: {
    label: "Offen",
    icon: <Clock className="size-3" />,
    className: "bg-warn-soft text-warn",
  },
  void: {
    label: "Storniert",
    icon: <AlertCircle className="size-3" />,
    className: "bg-surface-muted text-ink-muted",
  },
  uncollectible: {
    label: "Uneinbringlich",
    icon: <AlertCircle className="size-3" />,
    className: "bg-danger-soft text-danger",
  },
  draft: {
    label: "Entwurf",
    icon: <FileText className="size-3" />,
    className: "bg-surface-muted text-ink-muted",
  },
};

function euro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

export function InvoicesList() {
  const [items, setItems] = React.useState<Invoice[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(
    async (startingAfter: string | null, reset: boolean) => {
      const params = new URLSearchParams({ limit: "12" });
      if (startingAfter) params.set("starting_after", startingAfter);
      const res = await fetch(`/api/billing/invoices?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        items: Invoice[];
        nextCursor: string | null;
      };
      setItems((prev) => (reset ? body.items : [...prev, ...body.items]));
      setCursor(body.nextCursor);
    },
    [],
  );

  React.useEffect(() => {
    setLoading(true);
    void load(null, true).finally(() => setLoading(false));
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    await load(cursor, false);
    setLoadingMore(false);
  }

  return (
    <div className="rounded-squircle-md bg-surface shadow-card">
      <div className="p-6 border-b border-line-soft">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileText className="size-4" />
          Rechnungen
        </h3>
        <p className="text-xs text-ink-muted mt-1">
          Alle Rechnungen für Plattform-Zugang und Credit-Käufe. PDF-Download
          jederzeit. Für Rückfragen an den Steuerberater eignen sich die
          Stripe-PDFs (enthalten alle §14 UStG-Pflichtangaben).
        </p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin inline mr-2" />
          Lade Rechnungen …
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-ink-muted">
          Noch keine Rechnungen. Nach der ersten Zahlung erscheint sie hier.
        </div>
      ) : (
        <>
          <div className="divide-y divide-line">
            {items.map((inv) => {
              const statusInfo = STATUS_MAP[inv.status ?? "draft"] ?? STATUS_MAP.draft;
              return (
                <div key={inv.id} className="p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {inv.number ?? inv.id}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                            statusInfo.className,
                          )}
                        >
                          {statusInfo.icon}
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">
                        {inv.createdAt &&
                          new Date(inv.createdAt).toLocaleDateString("de-DE", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-base tabular-nums">
                        {euro(inv.total)}
                      </div>
                      <div className="text-[10px] text-ink-muted">brutto</div>
                    </div>
                  </div>

                  {/* Line-Items */}
                  <div className="mt-3 pl-2 border-l-2 border-line space-y-0.5">
                    {inv.lines.map((line, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs text-ink-muted"
                      >
                        <span className="truncate flex-1">
                          {line.quantity > 1 && `${line.quantity}× `}
                          {line.description || "Position"}
                        </span>
                        <span className="tabular-nums ml-2 shrink-0">
                          {euro(line.amount)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Aufschlüsselung + Aktionen */}
                  <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-ink-muted flex items-center gap-3">
                      <span>
                        Netto: <strong className="text-ink">{euro(inv.subtotal)}</strong>
                      </span>
                      <span>
                        MwSt: <strong className="text-ink">{euro(inv.tax)}</strong>
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {inv.invoicePdf && (
                        <a
                          href={inv.invoicePdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
                        >
                          <Download className="size-3" />
                          PDF
                        </a>
                      )}
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink ml-3"
                        >
                          <ExternalLink className="size-3" />
                          Ansehen
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {cursor && (
            <div className="p-4 border-t border-line text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                loading={loadingMore}
              >
                Ältere Rechnungen laden
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
