"use client";

/**
 * Blast-Detail (Kontrakt 7.4): Header + Fortschritt + Stat-Karten +
 * Aktionen (Pause/Fortsetzen/Abbrechen) + Message-Tabelle mit "Mehr
 * laden". Läuft der Blast, wird alle 15s über GET /api/email-blasts/[id]
 * (+ /messages) aktualisiert.
 */

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  Mail,
  MailX,
  MousePointerClick,
  Pause,
  Play,
  Reply,
  SkipForward,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface BlastMessageItem {
  id: string;
  leadId: string;
  toEmail: string;
  status: string;
  sentAt: string | null;
  repliedAt: string | null;
  unsubscribedAt: string | null;
  skipReason: string | null;
  error: string | null;
  clicked: boolean;
  leadData: Record<string, string>;
}

interface BlastData {
  id: string;
  status: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  bouncedCount: number;
  repliedCount: number;
  creditsCharged: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Counts {
  scheduled: number;
  sent: number;
  failed: number;
  skipped: number;
  bounced: number;
}

interface Engagement {
  clicks: number;
  unsubscribed: number;
}

interface MailboxInfo {
  emailAddress: string;
  status: string;
  effectiveDailyLimit: number;
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

const SKIP_REASON_LABELS: Record<string, string> = {
  no_email: "Keine E-Mail-Adresse",
  suppressed: "Auf Sperrliste",
  duplicate: "Doppelte Adresse",
  cancelled: "Versand abgebrochen",
  replied: "Hat geantwortet",
  unsubscribed: "Abgemeldet",
};

function displayName(data: Record<string, string>): string {
  const first =
    data.firstName ||
    data.Vorname ||
    data.vorname ||
    data.first_name ||
    data.fullName ||
    data.name ||
    "";
  const last =
    data.lastName || data.Nachname || data.nachname || data.last_name || "";
  const composed = [first, last].filter(Boolean).join(" ").trim();
  return composed || data.companyName || data.Firma || "(unbenannt)";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageBadge(m: BlastMessageItem): {
  label: string;
  variant: "brand" | "success" | "warn" | "danger" | "neutral";
} {
  if (m.unsubscribedAt) return { label: "Abgemeldet", variant: "danger" };
  if (m.repliedAt) return { label: "Geantwortet", variant: "success" };
  switch (m.status) {
    case "bounced":
      return { label: "Bounce", variant: "danger" };
    case "sent":
      return m.clicked
        ? { label: "Geklickt", variant: "brand" }
        : { label: "Versendet", variant: "success" };
    case "failed":
      return { label: "Fehler", variant: "danger" };
    case "skipped":
      return { label: "Übersprungen", variant: "neutral" };
    default:
      return { label: "Geplant", variant: "neutral" };
  }
}

export function BlastDetail(props: {
  campaignId: string;
  campaignName: string;
  initialBlast: BlastData;
  initialCounts: Counts;
  initialEngagement: Engagement;
  mailbox: MailboxInfo | null;
  initialMessages: BlastMessageItem[];
  initialTotalMessages: number;
  pageSize: number;
}) {
  const [blast, setBlast] = React.useState(props.initialBlast);
  const [counts, setCounts] = React.useState(props.initialCounts);
  const [engagement, setEngagement] = React.useState(props.initialEngagement);
  const [messages, setMessages] = React.useState(props.initialMessages);
  const [totalMessages, setTotalMessages] = React.useState(
    props.initialTotalMessages,
  );
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/email-blasts/${props.initialBlast.id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setBlast(data.blast);
      setCounts(data.counts);
      if (data.engagement) setEngagement(data.engagement);
      // Sichtbare Message-Seiten neu laden (gleiche Fenstergröße).
      const visible = Math.max(messagesRef.current.length, props.pageSize);
      const mres = await fetch(
        `/api/email-blasts/${props.initialBlast.id}/messages?offset=0&limit=${Math.min(visible, 200)}`,
        { cache: "no-store" },
      );
      if (mres.ok) {
        const mdata = await mres.json();
        setMessages(mdata.messages);
        setTotalMessages(mdata.total);
      }
    } catch {
      // Polling-Fehler still ignorieren
    }
  }, [props.initialBlast.id, props.pageSize]);

  React.useEffect(() => {
    if (blast.status !== "running") return;
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [blast.status, refresh]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/email-blasts/${blast.id}/messages?offset=${messages.length}&limit=${props.pageSize}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [
            ...prev,
            ...data.messages.filter((m: BlastMessageItem) => !known.has(m.id)),
          ];
        });
        setTotalMessages(data.total);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const runAction = async (action: "pause" | "resume" | "cancel") => {
    setActionBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/email-blasts/${blast.id}/${action}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Aktion fehlgeschlagen.");
        return;
      }
      if (data.blast) setBlast(data.blast);
      await refresh();
    } catch {
      setError("Aktion fehlgeschlagen.");
    } finally {
      setActionBusy(null);
      setConfirmCancel(false);
    }
  };

  const remaining = counts.scheduled;
  const perDay = props.mailbox?.effectiveDailyLimit ?? 0;
  const remainingDays =
    remaining > 0 && perDay > 0 ? Math.ceil(remaining / perDay) : 0;
  const progressPct =
    blast.totalCount > 0
      ? Math.round((blast.sentCount / blast.totalCount) * 100)
      : 0;

  return (
    <>
      <PageHeader
        title="E-Mail-Versand"
        subtitle={`Kampagne ${props.campaignName}${
          props.mailbox ? ` · über ${props.mailbox.emailAddress}` : ""
        }`}
        eyebrow={
          <Badge variant={blastBadgeVariant(blast.status)} dot>
            {STATUS_LABELS[blast.status] ?? blast.status}
          </Badge>
        }
        actions={
          <>
            {blast.status === "running" && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Pause className="size-4" />}
                loading={actionBusy === "pause"}
                onClick={() => void runAction("pause")}
              >
                Pausieren
              </Button>
            )}
            {blast.status === "paused" && (
              <Button
                variant="brand"
                size="sm"
                iconLeft={<Play className="size-4" />}
                loading={actionBusy === "resume"}
                onClick={() => void runAction("resume")}
              >
                Fortsetzen
              </Button>
            )}
            {(blast.status === "running" || blast.status === "paused") && (
              <Button
                variant="danger"
                size="sm"
                iconLeft={<Ban className="size-4" />}
                onClick={() => setConfirmCancel(true)}
              >
                Abbrechen
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-squircle-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="bg-surface rounded-squircle-md shadow-card p-6 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-ink">
            {blast.sentCount} von {blast.totalCount} versendet
            {remainingDays > 0 && (
              <span className="font-normal text-ink-muted">
                {" "}
                — noch ca. {remainingDays}{" "}
                {remainingDays === 1 ? "Werktag" : "Werktage"}
              </span>
            )}
          </p>
          <span className="text-xs text-ink-muted">
            Gestartet: {formatDateTime(blast.startedAt)}
            {blast.completedAt &&
              ` · Beendet: ${formatDateTime(blast.completedAt)}`}
          </span>
        </div>
        <Progress value={progressPct} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard
          label="Versendet"
          value={blast.sentCount}
          icon={<Mail />}
        />
        <StatCard
          label="Klicks"
          value={engagement.clicks}
          icon={<MousePointerClick />}
        />
        <StatCard
          label="Antworten"
          value={blast.repliedCount}
          icon={<Reply />}
        />
        <StatCard
          label="Bounces"
          value={blast.bouncedCount}
          icon={<MailX />}
        />
        <StatCard
          label="Abmeldungen"
          value={engagement.unsubscribed}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="Übersprungen"
          value={blast.skippedCount}
          icon={<SkipForward />}
        />
      </div>

      <div className="bg-surface rounded-squircle-md shadow-card overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-ink">
            Empfänger ({totalMessages})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-6 py-2.5 font-semibold">Lead</th>
                <th className="px-4 py-2.5 font-semibold">E-Mail</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-6 py-2.5 font-semibold">Zeitpunkt</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-ink-muted">
                    Keine Empfänger vorhanden.
                  </td>
                </tr>
              )}
              {messages.map((m) => {
                const badge = messageBadge(m);
                const detail =
                  m.error ??
                  (m.skipReason
                    ? SKIP_REASON_LABELS[m.skipReason] ?? m.skipReason
                    : null);
                return (
                  <tr key={m.id} className="border-b border-line-soft last:border-0">
                    <td className="px-6 py-3 font-medium text-ink">
                      {displayName(m.leadData)}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{m.toEmail || "—"}</td>
                    <td className="px-4 py-3">
                      <span title={detail ?? undefined}>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </span>
                    </td>
                    <td className="px-6 py-3 text-ink-muted">
                      {formatDateTime(
                        m.unsubscribedAt ?? m.repliedAt ?? m.sentAt,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {messages.length < totalMessages && (
          <div className="flex justify-center border-t border-line-soft px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              loading={loadingMore}
              onClick={() => void loadMore()}
            >
              Mehr laden ({messages.length} von {totalMessages})
            </Button>
          </div>
        )}
      </div>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Versand abbrechen?</DialogTitle>
            <DialogDescription>
              Alle noch nicht versendeten E-Mails werden verworfen. Für je 10
              nicht versendete Mails wird 1 Credit zurückerstattet. Diese
              Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
              Behalten
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionBusy === "cancel"}
              onClick={() => void runAction("cancel")}
            >
              Ja, abbrechen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
