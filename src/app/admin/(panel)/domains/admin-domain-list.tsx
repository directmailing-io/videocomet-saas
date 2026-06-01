"use client";

import * as React from "react";
import {
  Copy,
  Check,
  Globe,
  Search,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { AdminDomainDetailDrawer } from "./admin-domain-detail-drawer";

export interface AdminDomainRowSerialized {
  id: string;
  hostname: string;
  kind: "subdomain" | "apex";
  status: "pending" | "verifying" | "issuing_cert" | "active" | "failed";
  verifiedAt: string | null;
  sslIssuedAt: string | null;
  sslExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  userId: string;
  userEmail: string;
  userName: string | null;
}

interface Props {
  initialDomains: AdminDomainRowSerialized[];
}

const STATUS_LABEL: Record<AdminDomainRowSerialized["status"], string> = {
  pending: "Ausstehend",
  verifying: "Verifiziere",
  issuing_cert: "SSL-Cert",
  active: "Aktiv",
  failed: "Fehler",
};

function statusVariant(
  status: AdminDomainRowSerialized["status"],
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

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRel(d: string | null): string {
  if (!d) return "nie";
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

function isCertExpiringSoon(sslExpiresAt: string | null): boolean {
  if (!sslExpiresAt) return false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return new Date(sslExpiresAt).getTime() - Date.now() < 14 * DAY_MS;
}

function CopyButton({
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
      className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-line-soft hover:text-ink transition-colors"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AdminDomainList({ initialDomains }: Props): JSX.Element {
  const [domains, setDomains] = React.useState(initialDomains);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    setDomains(initialDomains);
  }, [initialDomains]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return domains.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!term) return true;
      return (
        d.hostname.toLowerCase().includes(term) ||
        d.userEmail.toLowerCase().includes(term) ||
        (d.userName ?? "").toLowerCase().includes(term)
      );
    });
  }, [domains, search, statusFilter]);

  const selectedDomain = React.useMemo(
    () => domains.find((d) => d.id === selectedId) ?? null,
    [domains, selectedId],
  );

  async function refreshList() {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/admin/domains", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        domains: AdminDomainRowSerialized[];
      };
      setDomains(data.domains);
    } catch {
      toast({ title: "Aktualisierung fehlgeschlagen.", variant: "danger" });
    } finally {
      setIsRefreshing(false);
    }
  }

  function openDrawer(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-0">
            <Input
              icon={<Search />}
              placeholder="Suche nach Hostname, Kunde oder E-Mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] h-[46px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="pending">Ausstehend</SelectItem>
                <SelectItem value="verifying">Verifiziere</SelectItem>
                <SelectItem value="issuing_cert">SSL-Cert</SelectItem>
                <SelectItem value="failed">Fehler</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              type="button"
              onClick={refreshList}
              loading={isRefreshing}
            >
              Aktualisieren
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Globe />}
              title={
                domains.length === 0
                  ? "Noch keine Domain verbunden."
                  : "Keine Domain entspricht dem Filter."
              }
              subtitle={
                domains.length === 0
                  ? "Sobald ein Kunde eine Custom-Domain verbindet, erscheint sie hier."
                  : "Passen Sie Suche oder Status-Filter an."
              }
            />
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>Kunde</TableHead>
                <TableHead>Art</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSL bis</TableHead>
                <TableHead>Letzter Check</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const expiringSoon = isCertExpiringSoon(d.sslExpiresAt);
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[13px] text-ink truncate max-w-[260px]">
                          {d.hostname}
                        </span>
                        <CopyButton
                          value={d.hostname}
                          label={`Hostname ${d.hostname} kopieren`}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm font-medium text-ink">
                          {d.userName || d.userEmail}
                        </span>
                        {d.userName && (
                          <span className="truncate text-xs text-ink-muted">
                            {d.userEmail}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">
                        {d.kind === "apex" ? "Apex" : "Subdomain"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(d.status)} dot>
                        {STATUS_LABEL[d.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.sslExpiresAt ? (
                        <span
                          className={cn(
                            "text-sm tabular-nums",
                            expiringSoon
                              ? "font-semibold text-danger"
                              : "text-ink-muted",
                          )}
                          title={formatDateTime(d.sslExpiresAt)}
                        >
                          {formatDate(d.sslExpiresAt)}
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm text-ink-muted tabular-nums">
                            {formatRel(d.lastCheckedAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {d.lastCheckedAt
                            ? formatDateTime(d.lastCheckedAt)
                            : "Noch nie geprüfte"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => openDrawer(d.id)}
                      >
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <AdminDomainDetailDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setSelectedId(null);
        }}
        domainSummary={selectedDomain}
        onDomainMutated={() => {
          void refreshList();
        }}
        onDomainDeleted={() => {
          setDrawerOpen(false);
          setSelectedId(null);
          void refreshList();
        }}
      />
    </TooltipProvider>
  );
}
