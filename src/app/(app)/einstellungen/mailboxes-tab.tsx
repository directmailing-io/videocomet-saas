"use client";

/**
 * E-Mail-Postfächer — Tab in /einstellungen.
 *
 * Karten je Postfach (Provider, Adresse, Status, heute X/Limit, Warmup,
 * Sendefenster) + Verbinden-Buttons (Microsoft OAuth / SMTP-Wizard).
 * Löschen wird von der API abgelehnt, solange ein laufender Blast das
 * Postfach nutzt.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toaster";
import {
  CalendarClock,
  Check,
  Copy,
  Flame,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { SerializedMailbox } from "@/lib/db/queries/mailboxes";
import type { MailboxSendWindow } from "@/lib/db/schema";
import { AddMailboxModal } from "./_components/add-mailbox-modal";

export interface MailboxesTabProps {
  m365Available: boolean;
  adminConsentUrl: string | null;
  initialM365Error: string | null;
  initialM365Connected: boolean;
}

const STATUS_LABEL: Record<SerializedMailbox["status"], string> = {
  connected: "Verbunden",
  token_expired: "Anmeldung abgelaufen",
  disabled: "Deaktiviert",
};

const STATUS_VARIANT: Record<
  SerializedMailbox["status"],
  "success" | "warn" | "neutral"
> = {
  connected: "success",
  token_expired: "warn",
  disabled: "neutral",
};

const DAY_SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function formatSendWindow(w: MailboxSendWindow): string {
  const days = Array.from(new Set(w.days)).sort((a, b) => a - b);
  let dayLabel: string;
  const isConsecutive =
    days.length > 1 && days[days.length - 1]! - days[0]! === days.length - 1;
  if (isConsecutive) {
    dayLabel = `${DAY_SHORT[days[0]!]}–${DAY_SHORT[days[days.length - 1]!]}`;
  } else {
    dayLabel = days.map((d) => DAY_SHORT[d]).join(", ");
  }
  return `${dayLabel}, ${w.startHour}–${w.endHour} Uhr`;
}

export function MailboxesTab({
  m365Available,
  adminConsentUrl,
  initialM365Error,
  initialM365Connected,
}: MailboxesTabProps) {
  const { toast } = useToast();

  const [mailboxes, setMailboxes] = React.useState<SerializedMailbox[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<SerializedMailbox | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<SerializedMailbox | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<{
    kind: "admin_consent" | "denied" | "failed" | "connected";
  } | null>(
    initialM365Connected
      ? { kind: "connected" }
      : initialM365Error === "admin_consent"
        ? { kind: "admin_consent" }
        : initialM365Error === "denied"
          ? { kind: "denied" }
          : initialM365Error
            ? { kind: "failed" }
            : null,
  );

  const fetchMailboxes = React.useCallback(async () => {
    try {
      const res = await fetch("/api/mailboxes", { cache: "no-store" });
      if (!res.ok) {
        toast({
          title: "Konnte Postfächer nicht laden",
          description: `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as { mailboxes?: SerializedMailbox[] };
      setMailboxes(body.mailboxes ?? []);
    } catch {
      toast({
        title: "Konnte Postfächer nicht laden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void fetchMailboxes();
  }, [fetchMailboxes]);

  async function handleTest(m: SerializedMailbox) {
    setTestingId(m.id);
    try {
      const res = await fetch(`/api/mailboxes/${m.id}/test`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          title: "Verbindungstest fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
      } else {
        toast({
          title: "Verbindung funktioniert",
          description: m.emailAddress,
          variant: "success",
        });
      }
      await fetchMailboxes();
    } catch {
      toast({
        title: "Verbindungstest fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggle(m: SerializedMailbox) {
    const next = m.status === "disabled" ? "connected" : "disabled";
    setTogglingId(m.id);
    try {
      const res = await fetch(`/api/mailboxes/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          title: "Änderung fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
      } else {
        toast({
          title:
            next === "disabled" ? "Postfach deaktiviert" : "Postfach aktiviert",
          description: m.emailAddress,
          variant: "success",
        });
      }
      await fetchMailboxes();
    } catch {
      toast({
        title: "Änderung fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mailboxes/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          title: "Löschen fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Postfach gelöscht",
        description: deleteTarget.emailAddress,
        variant: "success",
      });
      setDeleteTarget(null);
      await fetchMailboxes();
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setDeleting(false);
    }
  }

  const m365Button = (
    <Button
      size="sm"
      disabled={!m365Available}
      iconLeft={<Mail className="size-4" />}
      onClick={() => {
        window.location.href = "/api/auth/m365/connect";
      }}
    >
      Microsoft-Postfach verbinden
    </Button>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink">
                E-Mail-Postfächer
              </h2>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-2xl">
                Verbinden Sie Ihr eigenes Postfach, um personalisierte
                Video-E-Mails direkt über Ihre Adresse zu versenden — per
                Microsoft 365 oder per SMTP/IMAP bei jedem anderen Anbieter.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {m365Available ? (
                m365Button
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>{m365Button}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Die Microsoft-365-Anbindung ist auf diesem Server nicht
                    konfiguriert. Bitte wenden Sie sich an den Support.
                  </TooltipContent>
                </Tooltip>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAddOpen(true)}
                iconLeft={<Server className="size-4" />}
              >
                Anderes Postfach (SMTP/IMAP)
              </Button>
            </div>
          </div>

          {banner && (
            <M365Banner
              kind={banner.kind}
              adminConsentUrl={adminConsentUrl}
              onDismiss={() => setBanner(null)}
            />
          )}

          {loading ? (
            <div className="rounded-squircle-sm bg-surface-soft px-4 py-12 text-center text-sm text-ink-muted">
              Lade Postfächer ...
            </div>
          ) : !mailboxes || mailboxes.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Noch kein Postfach verbunden"
              subtitle="Verbinden Sie Ihr Firmen-Postfach, um E-Mails mit persönlichem Video direkt aus Ihrer eigenen Adresse zu versenden."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {m365Available ? (
                    m365Button
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{m365Button}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Die Microsoft-365-Anbindung ist auf diesem Server nicht
                        konfiguriert. Bitte wenden Sie sich an den Support.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAddOpen(true)}
                    iconLeft={<Plus className="size-4" />}
                  >
                    Anderes Postfach (SMTP/IMAP)
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {mailboxes.map((m) => (
                <MailboxCard
                  key={m.id}
                  mailbox={m}
                  testing={testingId === m.id}
                  toggling={togglingId === m.id}
                  onTest={() => void handleTest(m)}
                  onToggle={() => void handleToggle(m)}
                  onEdit={() => setEditTarget(m)}
                  onDelete={() => setDeleteTarget(m)}
                />
              ))}
            </div>
          )}
        </CardContent>

        <AddMailboxModal
          open={addOpen}
          onOpenChange={setAddOpen}
          onCreated={() => {
            void fetchMailboxes();
          }}
        />

        <EditWindowDialog
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void fetchMailboxes();
          }}
        />

        <Dialog
          open={deleteTarget !== null}
          onOpenChange={(o) => {
            if (!o && !deleting) setDeleteTarget(null);
          }}
        >
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Postfach wirklich löschen?</DialogTitle>
              <DialogDescription>
                Die Verbindung zu{" "}
                <span className="font-mono text-ink">
                  {deleteTarget?.emailAddress}
                </span>{" "}
                wird entfernt. Deine Zugangsdaten werden aus VIDEOCOMET
                gelöscht. Läuft aktuell ein Versand über dieses Postfach, wird
                das Löschen abgelehnt.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Abbrechen
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                loading={deleting}
                iconLeft={!deleting ? <Trash2 className="size-4" /> : undefined}
              >
                Endgültig löschen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </TooltipProvider>
  );
}

// ── M365-Ergebnis-Banner ────────────────────────────────────────────────────

function M365Banner({
  kind,
  adminConsentUrl,
  onDismiss,
}: {
  kind: "admin_consent" | "denied" | "failed" | "connected";
  adminConsentUrl: string | null;
  onDismiss: () => void;
}) {
  const { toast } = useToast();

  if (kind === "connected") {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-squircle-sm bg-ok-soft/60 px-4 py-3 text-sm text-ink">
        <Check className="size-4 text-ok shrink-0 mt-0.5" />
        <p className="flex-1">
          Ihr Microsoft-Postfach wurde erfolgreich verbunden.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold text-ink-muted hover:text-ink"
        >
          Schließen
        </button>
      </div>
    );
  }

  if (kind === "admin_consent") {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-4 py-3 text-sm text-ink">
        <ShieldAlert className="size-4 text-warn shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">
            Ihr IT-Administrator muss die Verbindung freigeben
          </p>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">
            In Ihrem Microsoft-Tenant ist die Zustimmung durch Mitarbeitende
            gesperrt (AADSTS65001). Senden Sie Ihrem Administrator den
            folgenden Freigabe-Link — danach können Sie das Postfach normal
            verbinden.
          </p>
          {adminConsentUrl && (
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-squircle-sm bg-surface px-2.5 py-1.5 text-[11px] text-ink">
                {adminConsentUrl}
              </code>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
                onClick={() => {
                  void navigator.clipboard.writeText(adminConsentUrl).then(
                    () =>
                      toast({
                        title: "Link kopiert",
                        variant: "success",
                        duration: 1500,
                      }),
                    () =>
                      toast({
                        title: "Kopieren fehlgeschlagen",
                        variant: "danger",
                      }),
                  );
                }}
              >
                <Copy className="size-3.5" />
                Kopieren
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold text-ink-muted hover:text-ink"
        >
          Schließen
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 flex items-start gap-3 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-4 py-3 text-sm text-ink">
      <TriangleAlert className="size-4 text-danger shrink-0 mt-0.5" />
      <p className="flex-1">
        {kind === "denied"
          ? "Sie haben die Microsoft-Anmeldung abgebrochen. Das Postfach wurde nicht verbunden."
          : "Die Microsoft-Verbindung ist fehlgeschlagen. Bitte versuchen Sie es erneut."}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-semibold text-ink-muted hover:text-ink"
      >
        Schließen
      </button>
    </div>
  );
}

// ── Postfach-Karte ──────────────────────────────────────────────────────────

function MailboxCard({
  mailbox: m,
  testing,
  toggling,
  onTest,
  onToggle,
  onEdit,
  onDelete,
}: {
  mailbox: SerializedMailbox;
  testing: boolean;
  toggling: boolean;
  onTest: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const providerLabel =
    m.provider === "m365" ? "Microsoft 365" : "SMTP/IMAP";

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
            {m.provider === "m365" ? (
              <Mail className="size-5" />
            ) : (
              <Server className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{m.emailAddress}</p>
            <p className="text-xs text-ink-muted">
              {providerLabel}
              {m.displayName ? ` · ${m.displayName}` : ""}
            </p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[m.status]} dot>
          {STATUS_LABEL[m.status]}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-squircle-sm bg-surface-soft px-2 py-2.5">
          <p className="text-sm font-semibold text-ink">
            {m.sentToday}/{m.effectiveDailyLimit}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">Heute versendet</p>
        </div>
        <div className="rounded-squircle-sm bg-surface-soft px-2 py-2.5">
          <p className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
            <Flame className="size-3.5 text-brand" />
            Stufe {m.warmupStage}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">Warmup</p>
        </div>
        <div className="rounded-squircle-sm bg-surface-soft px-2 py-2.5">
          <p className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
            <CalendarClock className="size-3.5 text-brand" />
            {formatSendWindow(m.sendWindow)}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Sendefenster · {m.timezone}
          </p>
        </div>
      </div>

      {m.lastError && m.status !== "connected" && (
        <p
          className="mt-3 truncate text-xs text-danger"
          title={m.lastError}
        >
          {m.lastError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1">
        {m.status === "token_expired" && m.provider === "m365" ? (
          <Button
            size="sm"
            variant="subtle"
            iconLeft={<RefreshCw className="size-3.5" />}
            onClick={() => {
              window.location.href = "/api/auth/m365/connect";
            }}
          >
            Neu verbinden
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={testing}
            iconLeft={!testing ? <RefreshCw className="size-3.5" /> : undefined}
            onClick={onTest}
          >
            Test erneut
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Settings2 className="size-3.5" />}
          onClick={onEdit}
        >
          Sendefenster
        </Button>
        {m.status !== "token_expired" && (
          <Button
            size="sm"
            variant="ghost"
            loading={toggling}
            onClick={onToggle}
          >
            {m.status === "disabled" ? "Aktivieren" : "Deaktivieren"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger hover:text-danger"
          iconLeft={<Trash2 className="size-3.5" />}
          onClick={onDelete}
        >
          Löschen
        </Button>
      </div>
    </div>
  );
}

// ── Sendefenster / Zeitzone / Tageslimit bearbeiten ─────────────────────────

const TIMEZONES = [
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/Luxembourg",
  "Europe/Amsterdam",
  "Europe/London",
  "UTC",
];

const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 7, label: "So" },
];

function EditWindowDialog({
  target,
  onClose,
  onSaved,
}: {
  target: SerializedMailbox | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = React.useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = React.useState(8);
  const [endHour, setEndHour] = React.useState(17);
  const [timezone, setTimezone] = React.useState("Europe/Berlin");
  const [dailyCap, setDailyCap] = React.useState(50);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!target) return;
    setDays(target.sendWindow.days);
    setStartHour(target.sendWindow.startHour);
    setEndHour(target.sendWindow.endHour);
    setTimezone(target.timezone);
    setDailyCap(target.dailyCap);
  }, [target]);

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : Array.from(new Set([...prev, day])).sort((a, b) => a - b),
    );
  }

  async function save() {
    if (!target) return;
    if (days.length === 0) {
      toast({
        title: "Kein Wochentag gewählt",
        description: "Bitte mindestens einen Versandtag auswählen.",
        variant: "danger",
      });
      return;
    }
    if (startHour >= endHour) {
      toast({
        title: "Sendefenster ungültig",
        description: "Die Start-Stunde muss vor der End-Stunde liegen.",
        variant: "danger",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/mailboxes/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sendWindow: { days, startHour, endHour },
          timezone,
          dailyCap,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          title: "Speichern fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Einstellungen gespeichert",
        description: target.emailAddress,
        variant: "success",
      });
      onSaved();
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  const hourOptions = Array.from({ length: 24 }, (_, i) => i);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Sendefenster &amp; Limits</DialogTitle>
          <DialogDescription>
            Wann darf VIDEOCOMET über{" "}
            <span className="font-mono text-ink">{target?.emailAddress}</span>{" "}
            versenden? Das Tageslimit ist zum Schutz deiner Domain auf maximal
            50 begrenzt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Versandtage</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => (
                <label
                  key={d.value}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                >
                  <Checkbox
                    checked={days.includes(d.value)}
                    onCheckedChange={() => toggleDay(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Von (Uhr)</Label>
              <Select
                value={String(startHour)}
                onValueChange={(v) => setStartHour(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hourOptions.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bis (Uhr)</Label>
              <Select
                value={String(endHour)}
                onValueChange={(v) => setEndHour(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hourOptions
                    .filter((h) => h > 0)
                    .concat([24])
                    .map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h}:00
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Zeitzone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(TIMEZONES.includes(timezone)
                    ? TIMEZONES
                    : [timezone, ...TIMEZONES]
                  ).map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mailbox-daily-cap">Tageslimit (max. 50)</Label>
              <Input
                id="mailbox-daily-cap"
                type="number"
                min={1}
                max={50}
                value={dailyCap}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    setDailyCap(Math.max(1, Math.min(50, Math.round(n))));
                  }
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
