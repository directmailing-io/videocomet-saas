"use client";

/**
 * „E-Mail-Versand starten" — Kampagnen-Auswahl, dann weiter zum
 * Blast-Wizard der Kampagne. Der Wizard springt bei „Abbrechen" über
 * ?zurueck=/versand hierher zurück.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface EmailVersandCampaignOption {
  id: string;
  name: string;
}

export function StartBlastDialog({
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
          <DialogTitle>E-Mail-Versand starten</DialogTitle>
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
                    href={`/kampagnen/${c.id}/email/neu?zurueck=/versand`}
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
