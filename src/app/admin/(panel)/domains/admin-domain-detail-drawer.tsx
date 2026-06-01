"use client";

/**
 * Admin Domain Detail Drawer
 *
 * Right-slide Dialog (Radix) — zeigt für eine ausgewählte Custom-Domain
 * alle Verwaltungs-Infos und Aktionen:
 *  - Kunden- und Status-Header
 *  - DNS-Instructions (CNAME/A + TXT) inkl. Copy-Buttons
 *  - Verify-Token (verschleiert + kopierbar)
 *  - lastError als rotes Callout
 *  - Aktionen: Force Recheck, Reset, Löschen (mit Impact-Bestätigung)
 *  - Check-History: letzte 20 DNS/TXT/Cert/Health-Log-Einträge
 *
 * Lifecycle: Beim Öffnen wird `/api/admin/domains/:id` gefetcht. Alle
 * Mutationen rufen `onDomainMutated()` so dass die Tabelle aktualisiert.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  X,
  Copy,
  Check,
  RotateCw,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Globe,
  Clock,
  Server,
  FileLock,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import type { AdminDomainRowSerialized } from "./admin-domain-list";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface AdminDomainDetail {
  id: string;
  hostname: string;
  kind: "subdomain" | "apex";
  status: "pending" | "verifying" | "issuing_cert" | "active" | "failed";
  verifyToken: string;
  verifiedAt: string | null;
  sslIssuedAt: string | null;
  sslExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  userId: string;
  dnsInstructions: {
    verifyRecord: DnsRecord;
    pointing: DnsRecord;
  };
}

interface LogEntry {
  id: string;
  ts: string;
  kind: "dns" | "txt" | "cert" | "health" | string;
  ok: boolean;
  message: string | null;
}

interface DetailPayload {
  domain: AdminDomainDetail;
  impact: { affectedCampaigns: number; affectedLeads: number };
  log: LogEntry[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domainSummary: AdminDomainRowSerialized | null;
  onDomainMutated: () => void;
  onDomainDeleted: () => void;
}

const STATUS_LABEL: Record<AdminDomainDetail["status"], string> = {
  pending: "Ausstehend",
  verifying: "Verifiziere",
  issuing_cert: "SSL-Cert",
  active: "Aktiv",
  failed: "Fehler",
};

function statusVariant(
  status: AdminDomainDetail["status"],
): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "active":
      return "success";
    case "pending":
    case "verifying":
    case "issuing_cert":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function formatDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRel(d: string | null): string {
  if (!d) return "—";
  const ts = new Date(d).getTime();
  if (!Number.isFinite(ts)) return "—";
  const ms = Date.now() - ts;
  if (ms < 0) return "gerade eben";
  if (ms < 60_000) return "gerade eben";
  if (ms < 3_600_000) return `vor ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `vor ${Math.floor(ms / 3_600_000)} Std`;
  if (ms < 30 * 86_400_000) return `vor ${Math.floor(ms / 86_400_000)} Tg.`;
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Verschleiert einen Verify-Token: erste 4 + letzte 4 sichtbar. */
function maskToken(token: string): string {
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function CopyInline({
  value,
  label,
}: {
  value: string;
  label?: string;
}): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Kopieren fehlgeschlagen.", variant: "danger" });
    }
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label ?? "Kopieren"}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-line-soft hover:text-ink transition-colors"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AdminDomainDetailDrawer({
  open,
  onOpenChange,
  domainSummary,
  onDomainMutated,
  onDomainDeleted,
}: Props): JSX.Element {
  const { toast } = useToast();
  const [data, setData] = React.useState<DetailPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revealToken, setRevealToken] = React.useState(false);
  const [busy, setBusy] = React.useState<
    null | "recheck" | "reset" | "delete"
  >(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const domainId = domainSummary?.id ?? null;

  // Fetch detail whenever drawer opens for a new domain.
  React.useEffect(() => {
    if (!open || !domainId) {
      setData(null);
      setError(null);
      setRevealToken(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/admin/domains/${domainId}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DetailPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Konnte Domain-Details nicht laden.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, domainId]);

  async function reloadDetail() {
    if (!domainId) return;
    try {
      const res = await fetch(`/api/admin/domains/${domainId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const payload = (await res.json()) as DetailPayload;
      setData(payload);
    } catch {
      // silent reload error — Aktion wurde u.U. schon durchgefuehrt.
    }
  }

  async function handleRecheck() {
    if (!domainId) return;
    setBusy("recheck");
    try {
      const res = await fetch(`/api/admin/domains/${domainId}/recheck`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Re-Check fehlgeschlagen.");
      }
      toast({ title: "Re-Check angestoßen.", variant: "success" });
      await reloadDetail();
      onDomainMutated();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Re-Check fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    if (!domainId) return;
    setBusy("reset");
    try {
      const res = await fetch(`/api/admin/domains/${domainId}/reset`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Reset fehlgeschlagen.");
      }
      toast({
        title: "Domain auf 'Ausstehend' zurückgesetzt.",
        variant: "success",
      });
      await reloadDetail();
      onDomainMutated();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Reset fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!domainId) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/domains/${domainId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Löschen fehlgeschlagen.");
      }
      toast({ title: "Domain gelöscht.", variant: "success" });
      setConfirmDelete(false);
      onDomainDeleted();
    } catch (err) {
      toast({
        title:
          err instanceof Error ? err.message : "Löschen fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  }

  const summary = domainSummary;
  const detail = data?.domain ?? null;
  const headerHost = detail?.hostname ?? summary?.hostname ?? "";
  const headerStatus = detail?.status ?? summary?.status ?? "pending";
  const customerLine = summary
    ? summary.userName
      ? `${summary.userName} · ${summary.userEmail}`
      : summary.userEmail
    : "";

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col overflow-hidden",
              "border-l border-line bg-surface shadow-lift",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
              "duration-200",
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold leading-tight text-ink">
                  <Globe className="size-4 shrink-0 text-ink-muted" />
                  <span className="font-mono truncate">
                    {headerHost || "Domain"}
                  </span>
                  <Badge variant={statusVariant(headerStatus)} dot>
                    {STATUS_LABEL[headerStatus]}
                  </Badge>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-0.5 text-xs text-ink-muted truncate">
                  {customerLine || "Custom-Domain-Details"}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                className="rounded-full p-1.5 text-ink-muted opacity-70 transition-opacity hover:bg-line-soft hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                aria-label="Schließen"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {loading && <DetailSkeleton />}

              {!loading && error && (
                <div className="rounded-squircle-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                  Fehler beim Laden: {error}
                </div>
              )}

              {!loading && !error && detail && data && (
                <>
                  {/* ── Last-Error-Callout ── */}
                  {detail.lastError && (
                    <div className="rounded-squircle-md border border-danger/30 bg-danger-soft p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="size-4 shrink-0 text-danger mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-danger">
                            Letzter Fehler
                          </p>
                          <p className="mt-1 text-sm text-ink break-words">
                            {detail.lastError}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Metadaten ── */}
                  <Section title="Metadaten" icon={<Clock className="size-4" />}>
                    <MetaGrid
                      items={[
                        { label: "Art", value: detail.kind === "apex" ? "Apex (Root-Domain)" : "Subdomain" },
                        { label: "Erstellt", value: formatDateTime(detail.createdAt) },
                        { label: "Verifiziert", value: formatDateTime(detail.verifiedAt) },
                        { label: "Letzter Check", value: formatDateTime(detail.lastCheckedAt) },
                        { label: "SSL ausgestellt", value: formatDateTime(detail.sslIssuedAt) },
                        { label: "SSL gueltig bis", value: formatDateTime(detail.sslExpiresAt) },
                      ]}
                    />
                  </Section>

                  {/* ── Verify-Token ── */}
                  <Section
                    title="Verify-Token"
                    icon={<FileLock className="size-4" />}
                  >
                    <div className="flex items-center gap-2 rounded-squircle-sm border border-line bg-surface-muted px-3 py-2">
                      <code className="flex-1 font-mono text-[12px] text-ink truncate">
                        {revealToken
                          ? detail.verifyToken
                          : maskToken(detail.verifyToken)}
                      </code>
                      <button
                        type="button"
                        onClick={() => setRevealToken((v) => !v)}
                        className="text-[11px] font-semibold text-brand-deep hover:underline"
                      >
                        {revealToken ? "Verbergen" : "Anzeigen"}
                      </button>
                      <CopyInline
                        value={detail.verifyToken}
                        label="Verify-Token kopieren"
                      />
                    </div>
                  </Section>

                  {/* ── DNS-Instructions ── */}
                  <Section
                    title="DNS-Einträge"
                    icon={<Server className="size-4" />}
                  >
                    <div className="space-y-2.5">
                      <DnsRecordRow
                        label="Pointing"
                        record={detail.dnsInstructions.pointing}
                      />
                      <DnsRecordRow
                        label="TXT-Verify"
                        record={detail.dnsInstructions.verifyRecord}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-ink-muted">
                      Diese Einträge muss der Kunde im DNS-Provider hinterlegen,
                      damit Routing und Cert-Issuance funktionieren.
                    </p>
                  </Section>

                  {/* ── Aktionen ── */}
                  <Section title="Aktionen" icon={<RotateCw className="size-4" />}>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="brand"
                        type="button"
                        onClick={handleRecheck}
                        loading={busy === "recheck"}
                        disabled={busy !== null}
                        iconLeft={<RefreshCw className="size-4" />}
                      >
                        Force Recheck
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={handleReset}
                        loading={busy === "reset"}
                        disabled={busy !== null}
                        iconLeft={<RotateCw className="size-4" />}
                      >
                        Auf "Ausstehend" zurücksetzen
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={busy !== null}
                        iconLeft={<Trash2 className="size-4" />}
                      >
                        Löschen
                      </Button>
                    </div>
                    {(data.impact.affectedCampaigns > 0 ||
                      data.impact.affectedLeads > 0) && (
                      <p className="mt-3 text-[12px] text-ink-muted">
                        Hinweis: Diese Domain ist mit{" "}
                        <span className="font-semibold text-ink">
                          {data.impact.affectedCampaigns}
                        </span>{" "}
                        Kampagne(n) und{" "}
                        <span className="font-semibold text-ink">
                          {data.impact.affectedLeads}
                        </span>{" "}
                        Lead(s) verknüpft. Beim Löschen werden deren
                        Custom-URLs ungültig.
                      </p>
                    )}
                  </Section>

                  {/* ── Check-History ── */}
                  <Section
                    title="Check-History"
                    icon={<Activity className="size-4" />}
                  >
                    {data.log.length === 0 ? (
                      <div className="rounded-squircle-sm border border-line bg-surface-muted px-3 py-6 text-center text-xs text-ink-muted">
                        Noch keine Checks protokolliert.
                      </div>
                    ) : (
                      <ul className="divide-y divide-line/60 rounded-squircle-sm border border-line bg-surface">
                        {data.log.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-start gap-3 px-3 py-2.5"
                          >
                            <span
                              className={cn(
                                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                                entry.ok
                                  ? "bg-ok-soft text-ok"
                                  : "bg-danger-soft text-danger",
                              )}
                            >
                              {entry.ok ? (
                                <CheckCircle2 className="size-3.5" />
                              ) : (
                                <XCircle className="size-3.5" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="flex items-center gap-2">
                                  <KindBadge kind={entry.kind} />
                                  <span
                                    className={cn(
                                      "text-[11px] font-semibold uppercase tracking-wider",
                                      entry.ok ? "text-ok" : "text-danger",
                                    )}
                                  >
                                    {entry.ok ? "OK" : "Fehler"}
                                  </span>
                                </span>
                                <span
                                  className="shrink-0 text-[11px] text-ink-muted tabular-nums"
                                  title={formatDateTime(entry.ts)}
                                >
                                  {formatRel(entry.ts)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-ink-muted break-words">
                                {entry.message ?? "—"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                </>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* ── Delete-Confirm Dialog ── */}
      <Dialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (busy !== "delete") setConfirmDelete(o);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Domain wirklich löschen?</DialogTitle>
            <DialogDescription>
              Der Eintrag <span className="font-mono text-ink">{headerHost}</span>{" "}
              wird unwiderruflich entfernt. Die Traefik-Konfiguration wird
              gleichzeitig bereinigt.
            </DialogDescription>
          </DialogHeader>

          {data && (
            <div className="rounded-squircle-md border border-warn/30 bg-warn-soft p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-4 shrink-0 text-warn mt-0.5" />
                <div className="flex-1 text-sm text-ink">
                  <p className="font-semibold">Auswirkungen</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
                    <li>
                      <span className="font-semibold text-ink">
                        {data.impact.affectedCampaigns}
                      </span>{" "}
                      Kampagne(n) verlieren ihre Custom-Domain-Zuordnung.
                    </li>
                    <li>
                      <span className="font-semibold text-ink">
                        {data.impact.affectedLeads}
                      </span>{" "}
                      Lead(s) bekommen ungueltige Custom-URLs.
                    </li>
                    <li>SSL-Cert wird durch Traefik nicht mehr erneuert.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={busy === "delete"}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={handleDelete}
              loading={busy === "delete"}
              iconLeft={<Trash2 className="size-4" />}
            >
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Sub-Components ─────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function MetaGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-squircle-sm border border-line bg-surface px-3 py-2"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            {it.label}
          </div>
          <div className="mt-0.5 text-sm text-ink tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function DnsRecordRow({
  label,
  record,
}: {
  label: string;
  record: DnsRecord;
}): JSX.Element {
  return (
    <div className="rounded-squircle-sm border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <Badge variant="brand">{record.type}</Badge>
      </div>
      <div className="grid grid-cols-[80px_1fr_auto] items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="text-ink-muted">Name</span>
        <code className="font-mono text-ink truncate">{record.name}</code>
        <CopyInline value={record.name} label={`${label} Name kopieren`} />

        <span className="text-ink-muted">Wert</span>
        <code className="font-mono text-ink truncate">{record.value}</code>
        <CopyInline value={record.value} label={`${label} Wert kopieren`} />
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }): JSX.Element {
  const labelMap: Record<string, string> = {
    dns: "DNS",
    txt: "TXT",
    cert: "Cert",
    health: "Health",
  };
  return <Badge variant="neutral">{labelMap[kind] ?? kind}</Badge>;
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="h-20 rounded-squircle-md border border-line bg-surface-muted animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-squircle-sm border border-line bg-surface-muted animate-pulse"
          />
        ))}
      </div>
      <div className="h-16 rounded-squircle-md border border-line bg-surface-muted animate-pulse" />
      <div className="h-24 rounded-squircle-md border border-line bg-surface-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-squircle-sm border border-line bg-surface-muted animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
