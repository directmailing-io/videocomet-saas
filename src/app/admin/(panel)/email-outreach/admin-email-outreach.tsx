"use client";

/**
 * Admin-Konsole E-Mail-Outreach (Kontrakt 7.7): Blast-Tabelle mit
 * Kill-Switch (Cancel wie User-Cancel inkl. Refund), rote Markierung bei
 * Bounce-Quote > 5 % sowie Suppression-Suche über alle User.
 */

import * as React from "react";
import { Ban, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AdminBlastItem {
  id: string;
  userEmail: string;
  campaignName: string;
  status: string;
  sentCount: number;
  totalCount: number;
  bouncedCount: number;
  repliedCount: number;
  startedAt: string | null;
  createdAt: string;
}

interface SuppressionItem {
  id: string;
  email: string;
  reason: string;
  userEmail: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  running: "Läuft",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  failed: "Fehlgeschlagen",
};

const REASON_LABELS: Record<string, string> = {
  unsubscribe: "Abmeldung",
  bounce: "Bounce",
  manual: "Manuell",
};

function statusVariant(
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
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function AdminEmailOutreach({
  initialBlasts,
}: {
  initialBlasts: AdminBlastItem[];
}) {
  const { toast } = useToast();
  const [blasts, setBlasts] = React.useState(initialBlasts);
  const [killTarget, setKillTarget] = React.useState<AdminBlastItem | null>(null);
  const [killBusy, setKillBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<SuppressionItem[] | null>(null);

  const killBlast = async () => {
    if (!killTarget) return;
    setKillBusy(true);
    try {
      const res = await fetch(`/api/admin/email-blasts/${killTarget.id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: data.error ?? "Abbrechen fehlgeschlagen.",
          variant: "danger",
        });
        return;
      }
      setBlasts((prev) =>
        prev.map((b) =>
          b.id === killTarget.id ? { ...b, status: "cancelled" } : b,
        ),
      );
      toast({ title: "Blast abgebrochen.", variant: "success" });
    } catch {
      toast({ title: "Abbrechen fehlgeschlagen.", variant: "danger" });
    } finally {
      setKillBusy(false);
      setKillTarget(null);
    }
  };

  const searchSuppressions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/email-suppressions?email=${encodeURIComponent(query.trim())}`,
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.suppressions);
      } else {
        toast({ title: "Suche fehlgeschlagen.", variant: "danger" });
      }
    } catch {
      toast({ title: "Suche fehlgeschlagen.", variant: "danger" });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-squircle-md shadow-card overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-ink">
            Blasts ({blasts.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-6 py-2.5 font-semibold">User</th>
                <th className="px-4 py-2.5 font-semibold">Kampagne</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Versendet</th>
                <th className="px-4 py-2.5 font-semibold">Bounce-Quote</th>
                <th className="px-4 py-2.5 font-semibold">Gestartet</th>
                <th className="px-6 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {blasts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-ink-muted">
                    Noch keine E-Mail-Blasts vorhanden.
                  </td>
                </tr>
              )}
              {blasts.map((b) => {
                const rate = b.sentCount > 0 ? b.bouncedCount / b.sentCount : 0;
                const high = rate > 0.05;
                return (
                  <tr
                    key={b.id}
                    className={cn(
                      "border-b border-line-soft last:border-0",
                      high && "bg-danger-soft/40",
                    )}
                  >
                    <td className="px-6 py-3 font-medium text-ink">
                      {b.userEmail}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{b.campaignName}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(b.status)} dot>
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink">
                      {b.sentCount} / {b.totalCount}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 tabular-nums",
                        high ? "font-semibold text-danger" : "text-ink-muted",
                      )}
                    >
                      {b.sentCount > 0 ? `${(rate * 100).toFixed(1)} %` : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {formatDate(b.startedAt)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {(b.status === "running" || b.status === "paused") && (
                        <Button
                          variant="danger"
                          size="sm"
                          iconLeft={<Ban className="size-3.5" />}
                          onClick={() => setKillTarget(b)}
                        >
                          Stoppen
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface rounded-squircle-md shadow-card p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">
          Suppression-Suche
        </h2>
        <p className="text-xs text-ink-muted mb-4">
          E-Mail-Adresse eingeben, um Sperrlisten-Einträge über alle Kunden zu
          finden.
        </p>
        <form onSubmit={searchSuppressions} className="flex gap-2 max-w-lg">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="z. B. max@firma.de"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="ghost" loading={searching}>
            Suchen
          </Button>
        </form>
        {results !== null && (
          <div className="mt-5 overflow-x-auto">
            {results.length === 0 ? (
              <p className="text-sm text-ink-muted">Keine Einträge gefunden.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                    <th className="py-2.5 pr-4 font-semibold">E-Mail</th>
                    <th className="py-2.5 pr-4 font-semibold">Grund</th>
                    <th className="py-2.5 pr-4 font-semibold">Kunde</th>
                    <th className="py-2.5 font-semibold">Datum</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-b border-line-soft last:border-0">
                      <td className="py-3 pr-4 font-medium text-ink">{r.email}</td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={r.reason === "bounce" ? "danger" : "neutral"}
                        >
                          {REASON_LABELS[r.reason] ?? r.reason}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">{r.userEmail}</td>
                      <td className="py-3 text-ink-muted">
                        {formatDate(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={killTarget !== null}
        onOpenChange={(open) => !open && setKillTarget(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Blast stoppen?</DialogTitle>
            <DialogDescription>
              {killTarget
                ? `Der Versand von ${killTarget.userEmail} (Kampagne „${killTarget.campaignName}") wird abgebrochen. Nicht versendete Mails werden verworfen, Credits anteilig erstattet.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setKillTarget(null)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={killBusy}
              onClick={() => void killBlast()}
            >
              Ja, stoppen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
