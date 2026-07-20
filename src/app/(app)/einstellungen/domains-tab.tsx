"use client";

/**
 * Custom-Domains — Tab in /einstellungen.
 *
 * Listet alle Domains des Users (max 3), erlaubt das Hinzufügen, Re-Check,
 * erneutes Öffnen der DNS-Instruktionen und das Löschen mit Impact-Anzeige
 * (betroffene Kampagnen + Leads).
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toaster";
import {
  CornerUpRight,
  Globe,
  Info,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { AddDomainModal } from "./_components/add-domain-modal";
import {
  type DomainListItem,
  type DomainStatus,
  formatAbsoluteDate,
  formatRelativeOrDate,
  statusBadgeVariant,
  statusLabel,
} from "./_components/domain-helpers";

const MAX_DOMAINS = 3;

interface ListResponse {
  domains?: DomainListItem[];
  error?: string;
}

interface ImpactPayload {
  affectedCampaigns: number;
  affectedLeads: number;
}

export function DomainsTab() {
  const { toast } = useToast();

  const [domains, setDomains] = React.useState<DomainListItem[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  // Add / Instruktionen
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalDomain, setModalDomain] = React.useState<DomainListItem | null>(
    null,
  );

  // Delete-Confirm
  const [deleteTarget, setDeleteTarget] = React.useState<DomainListItem | null>(
    null,
  );
  const [deleteImpact, setDeleteImpact] = React.useState<ImpactPayload | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  // Re-Check pro Zeile
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null);

  // Startseiten-Verhalten (Root-Redirect)
  const [rootTarget, setRootTarget] = React.useState<DomainListItem | null>(
    null,
  );

  const fetchDomains = React.useCallback(async () => {
    try {
      const res = await fetch("/api/domains", { cache: "no-store" });
      if (!res.ok) {
        toast({
          title: "Konnte Domains nicht laden",
          description: `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as ListResponse;
      setDomains(body.domains ?? []);
    } catch {
      toast({
        title: "Konnte Domains nicht laden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void fetchDomains();
  }, [fetchDomains]);

  function openAdd() {
    setModalDomain(null);
    setModalOpen(true);
  }

  function openInstructions(d: DomainListItem) {
    setModalDomain(d);
    setModalOpen(true);
  }

  async function handleVerify(d: DomainListItem) {
    setVerifyingId(d.id);
    try {
      const res = await fetch(`/api/domains/${d.id}/verify`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Prüfung fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Prüfung gestartet",
        description: d.hostname,
        variant: "success",
      });
      await fetchDomains();
    } catch {
      toast({
        title: "Prüfung fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setVerifyingId(null);
    }
  }

  async function openDelete(d: DomainListItem) {
    setDeleteTarget(d);
    setDeleteImpact(null);
    // Impact laden
    try {
      const res = await fetch(`/api/domains/${d.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { impact?: ImpactPayload };
      if (body.impact) setDeleteImpact(body.impact);
    } catch {
      // Impact ist optional — User kann trotzdem löschen
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/domains/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Löschen fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Domain gelöscht",
        description: deleteTarget.hostname,
        variant: "success",
      });
      setDeleteTarget(null);
      setDeleteImpact(null);
      await fetchDomains();
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

  const limitReached = (domains?.length ?? 0) >= MAX_DOMAINS;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">Custom-Domains</h2>
            <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-2xl">
              Verbinden Sie eigene (Sub-)Domains, damit personalisierte
              Landingpages unter Ihrer Marke ausgeliefert werden — z.B.{" "}
              <span className="font-mono text-ink">video.ihre-firma.de</span>.
              Maximal {MAX_DOMAINS} Domains pro Konto.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                void fetchDomains();
              }}
              loading={refreshing}
              iconLeft={<RefreshCw className="size-4" />}
            >
              Aktualisieren
            </Button>
            <Button
              size="sm"
              onClick={openAdd}
              disabled={limitReached}
              iconLeft={<Plus className="size-4" />}
              title={
                limitReached
                  ? `Limit von ${MAX_DOMAINS} Domains erreicht.`
                  : undefined
              }
            >
              Domain hinzufügen
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-squircle-sm bg-surface-soft px-4 py-12 text-center text-sm text-ink-muted">
            Lade Domains ...
          </div>
        ) : !domains || domains.length === 0 ? (
          <EmptyState
            icon={<Globe />}
            title="Noch keine Domain verbunden"
            subtitle="Senden Sie personalisierte Landingpages kuenftig von Ihrer eigenen Adresse aus."
            action={
              <Button
                onClick={openAdd}
                iconLeft={<Plus className="size-4" />}
              >
                Erste Domain hinzufügen
              </Button>
            }
          />
        ) : (
          <DomainsTable
            domains={domains}
            verifyingId={verifyingId}
            onInstructions={openInstructions}
            onVerify={handleVerify}
            onDelete={openDelete}
            onRootRedirect={setRootTarget}
          />
        )}

        {limitReached && (
          <div className="mt-4 flex items-start gap-2.5 rounded-squircle-sm bg-surface-soft px-3 py-2.5 text-xs text-ink-muted">
            <Info className="size-4 shrink-0 text-ink-muted mt-px" />
            <p>
              Sie haben das Limit von {MAX_DOMAINS} Domains pro Konto erreicht.
              Löschen Sie eine bestehende Domain, um eine neue hinzuzufuegen.
            </p>
          </div>
        )}
      </CardContent>

      <AddDomainModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        existingDomain={modalDomain}
        onDomainChanged={() => {
          void fetchDomains();
        }}
      />

      <RootRedirectDialog
        target={rootTarget}
        onClose={() => setRootTarget(null)}
        onSaved={() => {
          setRootTarget(null);
          void fetchDomains();
        }}
      />

      <DeleteDialog
        target={deleteTarget}
        impact={deleteImpact}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteImpact(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}

// ── Tabelle ─────────────────────────────────────────────────────────────────

interface DomainsTableProps {
  domains: DomainListItem[];
  verifyingId: string | null;
  onInstructions: (d: DomainListItem) => void;
  onVerify: (d: DomainListItem) => void;
  onDelete: (d: DomainListItem) => void;
  onRootRedirect: (d: DomainListItem) => void;
}

function DomainsTable({
  domains,
  verifyingId,
  onInstructions,
  onVerify,
  onDelete,
  onRootRedirect,
}: DomainsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Letzte Prüfung</TableHead>
          <TableHead>SSL gueltig bis</TableHead>
          <TableHead className="text-right">Aktionen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.map((d) => {
          const status = d.status as DomainStatus;
          const isVerifying = verifyingId === d.id;
          return (
            <TableRow key={d.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
                    <Globe className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink break-all">
                      {d.hostname}
                    </p>
                    <p className="text-xs text-ink-muted capitalize">
                      {d.kind === "apex" ? "Apex-Domain" : "Subdomain"}
                    </p>
                    {d.rootRedirectUrl ? (
                      <p
                        className="text-[11px] text-ink-muted mt-0.5 max-w-[240px] truncate"
                        title={`Startseite leitet weiter auf ${d.rootRedirectUrl}`}
                      >
                        <CornerUpRight className="size-3 inline mr-1 -mt-px" />
                        {d.rootRedirectUrl}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1 items-start">
                  <Badge variant={statusBadgeVariant(status)} dot>
                    {statusLabel(status)}
                  </Badge>
                  {status === "failed" && d.lastError && (
                    <span
                      className="text-[11px] text-danger max-w-[200px] truncate"
                      title={d.lastError}
                    >
                      {d.lastError}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-xs text-ink-muted">
                  {formatRelativeOrDate(d.lastCheckedAt)}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-xs text-ink-muted">
                  {formatAbsoluteDate(d.sslExpiresAt)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex items-center gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onInstructions(d)}
                    iconLeft={<Settings2 className="size-3.5" />}
                    title="DNS-Anweisungen anzeigen"
                  >
                    Anweisungen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onVerify(d)}
                    loading={isVerifying}
                    disabled={status === "active"}
                    iconLeft={<RefreshCw className="size-3.5" />}
                    title="Status sofort prüfen"
                  >
                    Prüfen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRootRedirect(d)}
                    iconLeft={<CornerUpRight className="size-3.5" />}
                    title="Was Besucher auf der Startseite der Domain sehen"
                  >
                    Startseite
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(d)}
                    iconLeft={<Trash2 className="size-3.5" />}
                    className="text-danger hover:text-danger"
                    title="Domain löschen"
                  >
                    Löschen
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Startseiten-Verhalten (Root-Redirect) ───────────────────────────────────

interface RootRedirectDialogProps {
  target: DomainListItem | null;
  onClose: () => void;
  onSaved: () => void;
}

function RootRedirectDialog({ target, onClose, onSaved }: RootRedirectDialogProps) {
  const { toast } = useToast();
  const open = target !== null;
  const [mode, setMode] = React.useState<"404" | "redirect">("404");
  const [url, setUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Beim Öffnen mit dem gespeicherten Stand der Domain initialisieren.
  React.useEffect(() => {
    if (!target) return;
    if (target.rootRedirectUrl) {
      setMode("redirect");
      setUrl(target.rootRedirectUrl);
    } else {
      setMode("404");
      setUrl("");
    }
  }, [target]);

  async function save() {
    if (!target) return;
    const value = mode === "redirect" ? url.trim() : null;
    if (mode === "redirect" && !value) {
      toast({
        title: "URL fehlt",
        description: "Bitte gib die Ziel-URL für die Weiterleitung an.",
        variant: "danger",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/domains/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootRedirectUrl: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Speichern fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Startseite aktualisiert",
        description:
          value === null
            ? `${target.hostname} zeigt jetzt die neutrale 404-Seite.`
            : `${target.hostname} leitet jetzt weiter auf ${value}.`,
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

  const optionBase =
    "w-full text-left rounded-squircle-sm border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";
  const optionActive = "border-brand bg-brand-soft/40";
  const optionInactive = "border-line hover:border-ink-muted/40";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Startseite der Domain</DialogTitle>
          <DialogDescription>
            Was sollen Besucher sehen, die{" "}
            <span className="font-mono text-ink">{target?.hostname}</span>{" "}
            direkt aufrufen — also ohne persönlichen Link?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <button
            type="button"
            className={`${optionBase} ${mode === "404" ? optionActive : optionInactive}`}
            onClick={() => setMode("404")}
          >
            <p className="text-sm font-semibold text-ink">
              Neutrale 404-Seite (Standard)
            </p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Dezente „Seite nicht gefunden"-Seite ohne jedes Branding —
              weder VIDEOCOMET noch Ihre Marke werden genannt.
            </p>
          </button>
          <button
            type="button"
            className={`${optionBase} ${mode === "redirect" ? optionActive : optionInactive}`}
            onClick={() => setMode("redirect")}
          >
            <p className="text-sm font-semibold text-ink">
              Auf eigene Seite weiterleiten
            </p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Besucher werden auf eine URL Ihrer Wahl umgeleitet, z.B. Ihre
              Firmen-Website.
            </p>
          </button>
        </div>

        {mode === "redirect" && (
          <div>
            <Label htmlFor="root-redirect-url">Ziel-URL</Label>
            <Input
              id="root-redirect-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ihre-firma.de"
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

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

// ── Delete-Confirm ──────────────────────────────────────────────────────────

interface DeleteDialogProps {
  target: DomainListItem | null;
  impact: ImpactPayload | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteDialog({
  target,
  impact,
  deleting,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  const open = target !== null;
  const hasImpact =
    impact !== null &&
    (impact.affectedCampaigns > 0 || impact.affectedLeads > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Domain wirklich löschen?</DialogTitle>
          <DialogDescription>
            Die Domain <span className="font-mono">{target?.hostname}</span>{" "}
            wird sofort getrennt. Aktive Custom-URLs gehen ins Leere — die
            personalisierten Landingpages sind dann nur noch über die
            VIDEOCOMET-Standard-URL erreichbar.
          </DialogDescription>
        </DialogHeader>

        {hasImpact && impact && (
          <div className="flex items-start gap-3 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-3 py-3 text-sm text-ink">
            <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Betroffene Daten</p>
              <ul className="mt-1 text-xs text-ink-muted leading-relaxed list-disc list-inside">
                <li>{impact.affectedCampaigns} Kampagne(n)</li>
                <li>{impact.affectedLeads} Lead(s)</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={deleting}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={deleting}
            iconLeft={!deleting ? <Trash2 className="size-4" /> : undefined}
          >
            Endgueltig löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
