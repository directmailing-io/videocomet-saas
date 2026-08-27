"use client";

/**
 * Tab „E-Mails" der Versandzentrale: alle Blasts des Users über alle
 * Kampagnen in einer Tabelle + Dialog „Neuen Versand starten" mit
 * Kampagnen-Auswahl. (Vorher eigenständige Seite /email-versand.)
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Mail, Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface EmailVersandBlastRow {
  id: string;
  campaignId: string;
  campaignName: string;
  status: string;
  totalCount: number;
  sentCount: number;
  startedAt: string | null;
  createdAt: string;
}

export interface EmailVersandCampaignOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  running: "Läuft",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  failed: "Fehlgeschlagen",
};

function blastBadgeVariant(
  status: string,
): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "running":
      return "brand";
    case "completed":
      return "success";
    case "paused":
      return "warn";
    case "cancelled":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/** Dialog mit Kampagnen-Auswahl → weiter zum Blast-Wizard der Kampagne. */
function StartBlastDialog({
  open,
  onOpenChange,
  campaigns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: EmailVersandCampaignOption[];
}) {
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Neuen Versand starten</DialogTitle>
          <DialogDescription>
            Wählen Sie die Kampagne, deren Leads Sie anschreiben möchten.
          </DialogDescription>
        </DialogHeader>
        {campaigns.length === 0 ? (
          <p className="text-sm text-ink-muted py-2">
            Noch keine Kampagne mit Leads vorhanden. Starten Sie zuerst eine
            Runde mit einer Lead-Liste.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Kampagne suchen …"
                autoFocus
                className="w-full rounded-squircle-md bg-surface-soft py-2.5 pl-10 pr-3.5 text-sm text-ink placeholder:text-ink-muted outline-none ring-brand/40 transition-shadow focus:ring-2"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-sm text-ink-muted">
                Keine Kampagne gefunden.
              </p>
            ) : (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-1">
                {filtered.map((c) => (
                  <Link
                    key={c.id}
                    href={`/kampagnen/${c.id}/email/neu`}
                    onClick={() => onOpenChange(false)}
                    className="group flex items-center justify-between gap-3 rounded-squircle-md px-3.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                  >
                    <span className="truncate">{c.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EmailBlastsPanel({
  blasts,
  campaigns,
}: {
  blasts: EmailVersandBlastRow[];
  campaigns: EmailVersandCampaignOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const startButton = (
    <Button
      iconLeft={<Send className="size-4" />}
      onClick={() => setDialogOpen(true)}
    >
      Neuen Versand starten
    </Button>
  );

  return (
    <>
      {blasts.length === 0 ? (
        <div className="bg-surface rounded-squircle-lg shadow-card">
          <EmptyState
            icon={<Mail />}
            title="Noch keine E-Mail-Versände"
            subtitle="Verbinden Sie ein Postfach und starten Sie den ersten Versand."
            action={startButton}
          />
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">{startButton}</div>
          <div className="bg-surface rounded-squircle-lg shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th className="px-6 py-2.5 font-semibold">Kampagne</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Fortschritt</th>
                  <th className="px-4 py-2.5 font-semibold">Gestartet am</th>
                  <th className="px-6 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {blasts.map((b) => {
                  const pct =
                    b.totalCount > 0
                      ? Math.round((b.sentCount / b.totalCount) * 100)
                      : 0;
                  const href = `/kampagnen/${b.campaignId}/email/${b.id}`;
                  return (
                    <tr
                      key={b.id}
                      onClick={() => router.push(href)}
                      className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-surface-soft transition-colors"
                    >
                      <td className="px-6 py-3.5 font-medium text-ink">
                        <span className="line-clamp-1">{b.campaignName}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={blastBadgeVariant(b.status)} dot>
                          {STATUS_LABELS[b.status] ?? b.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="tabular-nums font-medium text-ink">
                          {b.sentCount} / {b.totalCount}
                        </span>
                        <span className="text-ink-muted"> ({pct} %)</span>
                      </td>
                      <td className="px-4 py-3.5 text-ink-muted">
                        {formatDate(b.startedAt)}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex text-ink-muted hover:text-ink"
                          aria-label="Details öffnen"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <StartBlastDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaigns={campaigns}
      />
    </>
  );
}
