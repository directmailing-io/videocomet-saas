"use client";

import * as React from "react";
import Link from "next/link";
import {
  Copy,
  ExternalLink,
  Mail,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { ActivityFeedRow, LeadDrawerData } from "../activity-center";
import { TemperatureBadge } from "./temperature-badge";
import { EventIcon, describeKind } from "./event-icon";

/**
 * LeadDrawer — Right-Side-Slide-In, 480px breit. Wir bauen ihn als Radix
 * Dialog mit Focus-Trap und role="dialog" — Open-State steuert das Parent.
 *
 * Inhalt:
 *  - Header (Name · Firma · Temperatur-Badge · Lead-Detail-Link)
 *  - 4 Mini-Stats (Page-Views · Watch-Time · CTA-Klicks · Sessions)
 *  - Timeline aller Events DESC
 *  - Footer-Actions
 *
 * Pfeiltasten ↑/↓ navigieren Rows OHNE den Drawer zu schließen — das
 * routen wir vom Parent über `onNavigate`. Esc schließt.
 */
export interface LeadDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vorab-Daten aus dem geklickten Feed-Row (Identity-Infos). */
  selectedRow: ActivityFeedRow | null;
  /** Lazy-loaded vom Parent. Null = lädt, "error" = fehler. */
  data: LeadDrawerData | null | "error";
  loading: boolean;
  onNavigate: (dir: "prev" | "next") => void;
}

export function LeadDrawer({
  open,
  onOpenChange,
  selectedRow,
  data,
  loading,
  onNavigate,
}: LeadDrawerProps) {
  const { toast } = useToast();

  // Pfeiltasten innerhalb des Drawers → Parent-Navigation. Verhindert
  // dass die globale Shortcut-Hook in EditableTarget-Logik feuert.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onNavigate("next");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onNavigate("prev");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onNavigate]);

  const lead = selectedRow?.lead ?? null;
  const stats = typeof data === "object" && data ? data.stats : null;
  const events = typeof data === "object" && data ? data.events : null;
  const email = typeof data === "object" && data ? data.email : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-[480px] bg-surface border-l border-line shadow-lift",
            "flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200",
          )}
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Lead-Details
          </DialogPrimitive.Title>

          {/* Header */}
          <header className="flex items-start gap-3 p-5 border-b border-line">
            <div className="flex-1 min-w-0">
              {lead ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <TemperatureBadge temperature={lead.temperature} />
                    {lead.slug && (
                      <Link
                        href={`/leads/${lead.slug}`}
                        className="text-xs text-brand-deep hover:underline inline-flex items-center gap-1"
                      >
                        Lead-Detail
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-ink truncate">
                    {lead.name || "Unbekannter Lead"}
                  </h2>
                  {lead.companyName && (
                    <p className="text-sm text-ink-muted truncate">
                      {lead.companyName}
                    </p>
                  )}
                </>
              ) : (
                <h2 className="text-lg font-bold text-ink">Lead-Details</h2>
              )}
            </div>
            <DialogPrimitive.Close
              className="p-1.5 rounded-full text-ink-muted hover:text-ink hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              aria-label="Schließen"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          {/* Mini-Stats */}
          <div className="grid grid-cols-4 gap-2 px-5 py-4 border-b border-line-soft">
            <StatTile label="Aufrufe" value={stats?.pageViews ?? "–"} />
            <StatTile label="Watch-Time" value={stats ? formatDuration(stats.watchTimeSec) : "–"} />
            <StatTile label="CTA-Klicks" value={stats?.ctaClicks ?? "–"} />
            <StatTile label="Sessions" value={stats?.sessions ?? "–"} />
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
              Chronologie
            </h3>
            {loading && !events && (
              <div className="space-y-3" aria-live="polite">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-squircle-sm bg-surface-muted animate-pulse"
                  />
                ))}
              </div>
            )}
            {data === "error" && (
              <p className="text-sm text-danger">
                Die Aktivität konnte nicht geladen werden.
              </p>
            )}
            {events && events.length === 0 && (
              <p className="text-sm text-ink-muted">
                Noch keine Events für diesen Lead.
              </p>
            )}
            {events && events.length > 0 && (
              <ol className="flex flex-col gap-3" role="list">
                {events.map((ev) => (
                  <li key={ev.eventId} className="flex items-start gap-3">
                    <EventIcon kind={ev.kind} size="sm" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-ink">
                        {describeKind(ev.kind, ev.payload)}
                      </span>
                      <span className="text-xs text-ink-muted tabular-nums">
                        {formatFullTime(ev.ts)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Footer */}
          <footer className="flex flex-wrap gap-2 p-4 border-t border-line bg-surface-muted/40">
            {selectedRow?.run?.id && selectedRow?.campaign?.id && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/kampagnen/${selectedRow.campaign.id}/runs/${selectedRow.run.id}`}
                >
                  In Run anzeigen
                </Link>
              </Button>
            )}
            {selectedRow?.campaign?.id && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/kampagnen/${selectedRow.campaign.id}`}>
                  In Kampagne anzeigen
                </Link>
              </Button>
            )}
            {email && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Mail className="size-3.5" />}
                onClick={() => {
                  void copyToClipboard(email).then((ok) => {
                    toast({
                      title: ok ? "E-Mail kopiert" : "Kopieren fehlgeschlagen",
                      description: ok ? email : "Bitte manuell auswählen.",
                      variant: ok ? "success" : "danger",
                    });
                  });
                }}
              >
                E-Mail kopieren
                <Copy className="size-3.5 opacity-60" />
              </Button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-squircle-sm bg-surface px-2 py-2 border border-line">
      <span className="text-[10px] uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span className="text-sm font-bold text-ink tabular-nums truncate">
        {value}
      </span>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}
