"use client";

/**
 * CRM-Integrationen — Liste + Add/Revoke-Flow im Einstellungen-Tab.
 *
 * Listet alle CRM-Integrationen des Users (HubSpot, Salessuite, Close).
 * Erlaubt das Anlegen einer neuen Integration (mit Live-`testConnection`
 * beim Submit), das erneute Testen einer bestehenden und das Löschen
 * (mit `?force=true`-Fallback, falls die Integration noch in Kampagnen
 * verwendet wird).
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toaster";
import {
  CheckCircle2,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Typen ───────────────────────────────────────────────────────────────────

export type CrmProviderId = "hubspot" | "salessuite" | "close";

export interface CrmIntegrationRow {
  id: string;
  provider: CrmProviderId;
  name: string;
  apiKeyHint: string | null;
  createdAt: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  disabledAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface ListResponse {
  integrations?: CrmIntegrationRow[];
  error?: string;
}

const PROVIDER_LABEL: Record<CrmProviderId, string> = {
  hubspot: "HubSpot",
  salessuite: "Salessuite",
  close: "Close",
};

const PROVIDER_BADGE_CLASS: Record<CrmProviderId, string> = {
  hubspot: "bg-[#FF7A59]/15 text-[#C13B1B] border border-[#FF7A59]/30",
  salessuite: "bg-[#1F6FEB]/15 text-[#1F4FA8] border border-[#1F6FEB]/30",
  close: "bg-[#16A34A]/15 text-[#15803D] border border-[#16A34A]/30",
};

const PROVIDER_INITIAL: Record<CrmProviderId, string> = {
  hubspot: "H",
  salessuite: "S",
  close: "C",
};

// ── Komponente ──────────────────────────────────────────────────────────────

export function IntegrationsList() {
  const { toast } = useToast();

  const [rows, setRows] = React.useState<CrmIntegrationRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const [addOpen, setAddOpen] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<CrmIntegrationRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteUsageCount, setDeleteUsageCount] = React.useState<number | null>(
    null,
  );

  const fetchRows = React.useCallback(async () => {
    try {
      const res = await fetch("/api/crm/integrations", { cache: "no-store" });
      if (!res.ok) {
        toast({
          title: "Konnte CRM-Integrationen nicht laden",
          description: `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as ListResponse;
      setRows(body.integrations ?? []);
    } catch {
      toast({
        title: "Konnte CRM-Integrationen nicht laden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  async function handleTest(row: CrmIntegrationRow) {
    setTestingId(row.id);
    try {
      const res = await fetch(`/api/crm/integrations/${row.id}/test`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (body.ok) {
        toast({
          title: "Verbindung erfolgreich",
          description: row.name,
          variant: "success",
        });
      } else {
        toast({
          title: "Verbindungstest fehlgeschlagen",
          description: body.error ?? "Unbekannter Fehler",
          variant: "danger",
        });
      }
      await fetchRows();
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

  async function openDelete(row: CrmIntegrationRow) {
    setDeleteTarget(row);
    setDeleteUsageCount(null);
  }

  async function confirmDelete(force: boolean) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url = `/api/crm/integrations/${deleteTarget.id}${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          count?: number;
        };
        setDeleteUsageCount(body.count ?? 0);
        return;
      }
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
        title: "Integration gelöscht",
        description: deleteTarget.name,
        variant: "success",
      });
      setDeleteTarget(null);
      setDeleteUsageCount(null);
      await fetchRows();
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

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">CRM-Integrationen</h2>
            <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-2xl">
              Verbinden Sie Ihr CRM (HubSpot, Salessuite oder Close), damit
              Lead-Events (Landingpage-Aufruf, Video-Play, CTA-Klick) automatisch
              im CRM hinterlegt werden.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                void fetchRows();
              }}
              loading={refreshing}
              iconLeft={<RefreshCw className="size-4" />}
            >
              Aktualisieren
            </Button>
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              iconLeft={<Plus className="size-4" />}
            >
              Neue Integration
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-squircle-md border border-line bg-surface-muted/40 px-4 py-12 text-center text-sm text-ink-muted">
            Lade Integrationen ...
          </div>
        ) : !rows || rows.length === 0 ? (
          <EmptyState
            icon={<Plug />}
            title="Noch keine CRM-Integration angelegt"
            subtitle="Verbinden Sie HubSpot, Salessuite oder Close, um Lead-Events automatisch ins CRM zu spiegeln."
            action={
              <Button
                onClick={() => setAddOpen(true)}
                iconLeft={<Plus className="size-4" />}
              >
                Erste Integration anlegen
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rows.map((row) => (
              <IntegrationCard
                key={row.id}
                row={row}
                testing={testingId === row.id}
                onTest={() => handleTest(row)}
                onDelete={() => void openDelete(row)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AddIntegrationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          void fetchRows();
        }}
      />

      <DeleteIntegrationDialog
        target={deleteTarget}
        usageCount={deleteUsageCount}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteUsageCount(null);
          }
        }}
        onConfirm={(force) => void confirmDelete(force)}
      />
    </Card>
  );
}

// ── Card pro Integration ────────────────────────────────────────────────────

function IntegrationCard({
  row,
  testing,
  onTest,
  onDelete,
}: {
  row: CrmIntegrationRow;
  testing: boolean;
  onTest: () => void;
  onDelete: () => void;
}) {
  const status = computeStatus(row);
  return (
    <div className="rounded-squircle-md border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-squircle-sm shrink-0 text-base font-bold",
            PROVIDER_BADGE_CLASS[row.provider],
          )}
        >
          {PROVIDER_INITIAL[row.provider]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-ink truncate">{row.name}</p>
            <span className="text-[11px] text-ink-muted">
              {PROVIDER_LABEL[row.provider]}
            </span>
          </div>
          <p className="text-xs text-ink-muted font-mono mt-0.5">
            ••••{row.apiKeyHint ?? "????"}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {status === "disabled" && row.lastTestError && (
        <p className="text-xs text-danger break-words" title={row.lastTestError}>
          {row.lastTestError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-ink-muted">
          {formatLastTested(row.lastTestedAt)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            loading={testing}
            iconLeft={<RefreshCw className="size-3.5" />}
          >
            Neu testen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            iconLeft={<Trash2 className="size-3.5" />}
            className="text-danger hover:text-danger"
          >
            Löschen
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Status-Pill ─────────────────────────────────────────────────────────────

type IntegrationStatus = "ok" | "disabled" | "unknown";

function computeStatus(row: CrmIntegrationRow): IntegrationStatus {
  if (row.disabledAt) return "disabled";
  if (row.lastTestOk === true) return "ok";
  if (row.lastTestOk === false) return "disabled";
  return "unknown";
}

function StatusPill({ status }: { status: IntegrationStatus }) {
  if (status === "ok") {
    return (
      <Badge variant="success" dot>
        Verbunden
      </Badge>
    );
  }
  if (status === "disabled") {
    return (
      <Badge variant="danger" dot>
        Deaktiviert
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" dot>
      Unbekannt
    </Badge>
  );
}

function formatLastTested(iso: string | null): string {
  if (!iso) return "noch nicht getestet";
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "noch nicht getestet";
    const diff = Date.now() - then;
    const min = Math.round(diff / 60_000);
    if (min < 1) return "zuletzt getestet vor wenigen Sekunden";
    if (min < 60) return `zuletzt getestet vor ${min} min`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `zuletzt getestet vor ${hrs} h`;
    const days = Math.round(hrs / 24);
    return `zuletzt getestet vor ${days} d`;
  } catch {
    return "noch nicht getestet";
  }
}

// ── Add-Dialog ──────────────────────────────────────────────────────────────

function AddIntegrationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [provider, setProvider] = React.useState<CrmProviderId>("hubspot");
  const [name, setName] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setProvider("hubspot");
        setName("");
        setApiKey("");
        setError(null);
        setSubmitting(false);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !apiKey.trim()) {
      setError("Bitte Name und API-Key angeben.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          name: name.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      if (res.ok) {
        toast({
          title: "Integration angelegt",
          description: name.trim(),
          variant: "success",
        });
        onCreated();
        onOpenChange(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        setError(body.error ?? "Name bereits vergeben.");
      } else if (res.status === 400) {
        setError(body.error ?? "Verbindungstest fehlgeschlagen.");
      } else {
        setError(body.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Neue CRM-Integration</DialogTitle>
          <DialogDescription>
            Wählen Sie Ihren CRM-Anbieter aus und hinterlegen Sie einen API-Key
            mit Schreibrechten auf Kontakten.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <Label>Anbieter</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["hubspot", "salessuite", "close"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={cn(
                    "rounded-squircle-sm border px-3 py-3 text-left transition-colors",
                    "flex items-center gap-2.5",
                    provider === p
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface hover:bg-surface-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-squircle-sm shrink-0 text-sm font-bold",
                      PROVIDER_BADGE_CLASS[p],
                    )}
                  >
                    {PROVIDER_INITIAL[p]}
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {PROVIDER_LABEL[p]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="crm-integration-name">Name</Label>
            <Input
              id="crm-integration-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Prod HubSpot"
              autoComplete="off"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Frei wählbar — hilft Ihnen, mehrere Integrationen zu unterscheiden.
            </p>
          </div>

          <div>
            <Label htmlFor="crm-integration-key">API-Key</Label>
            <Input
              id="crm-integration-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API-Key hier einfügen"
              autoComplete="off"
              disabled={submitting}
              icon={<KeyRound />}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Der Key wird verschlüsselt gespeichert. Wir testen die Verbindung
              direkt beim Speichern.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-sm text-danger">
              <TriangleAlert className="size-4 shrink-0 mt-0.5" />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Abbrechen
            </Button>
            <Button type="submit" loading={submitting}>
              Integration anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete-Dialog ───────────────────────────────────────────────────────────

function DeleteIntegrationDialog({
  target,
  usageCount,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: CrmIntegrationRow | null;
  usageCount: number | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const open = target !== null;
  const inUse = usageCount !== null && usageCount > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Integration löschen?</DialogTitle>
          <DialogDescription>
            Die Integration{" "}
            <span className="font-semibold text-ink">{target?.name}</span>{" "}
            wird sofort gelöscht. Der hinterlegte API-Key wird vernichtet.
          </DialogDescription>
        </DialogHeader>

        {inUse && (
          <div className="flex items-start gap-3 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-3 py-3 text-sm text-ink">
            <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                Wird in {usageCount} Kampagne(n) verwendet
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Beim erzwungenen Löschen werden die CRM-Settings dieser
                Kampagnen mit entfernt. Lead-Events werden dort nicht mehr ins
                CRM gespiegelt.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={deleting}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(inUse)}
            loading={deleting}
            iconLeft={
              !deleting && inUse ? (
                <TriangleAlert className="size-4" />
              ) : !deleting ? (
                <Trash2 className="size-4" />
              ) : undefined
            }
          >
            {inUse ? "Trotzdem löschen" : "Endgültig löschen"}
          </Button>
        </DialogFooter>

        {!inUse && usageCount === null && deleting === false && (
          <p className="text-[11px] text-ink-muted -mt-1 inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-ok" />
            Wird in keiner Kampagne verwendet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
