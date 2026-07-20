"use client";

/**
 * Webhooks-Liste — Add/Edit-Flow, Rotate-Secret, Test, Enable/Disable, Delete
 * sowie der "Auslieferungen ansehen"-Drawer.
 *
 * Strukturell modelliert nach `integrations-list.tsx`: gleiche Card-Top-Row
 * (Tile-Icon + Titel + Scope-Badge + Status-Pill), gleiche Add-Dialog-Wiring
 * und gleiches Toast-/Refresh-Pattern. Der einzige zusätzliche Komplexitäts-
 * Block ist das Secret-Reveal-Modal als Zwei-Stufen-Flow nach CREATE/ROTATE.
 *
 * Wenn der Caller `campaignFilterId` setzt (Kampagnen-Tab), zeigt die Liste
 * nur Endpoints, die a) account-weit (campaignId === null) ODER b) genau
 * diese Kampagne adressieren. Das passt zur Server-seitigen Routing-Logik
 * ("Bei Event aus Kampagne X feuern alle X-spezifischen + alle account-weiten
 * Endpoints").
 */

import * as React from "react";
import {
  ListTree,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  TestTube2,
  Trash2,
  TriangleAlert,
  Webhook as WebhookIcon,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

import { WEBHOOK_EVENT_LABELS } from "./event-labels";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookSecretReveal } from "./webhook-secret-reveal";
import { WebhookDeliveriesLog } from "./webhook-deliveries-log";
import type { WebhookEndpoint } from "./types";

interface ListResponse {
  endpoints?: WebhookEndpoint[];
  error?: string;
}

interface CampaignsResponse {
  campaigns?: Array<{ id: string; name: string }>;
  error?: string;
}

export interface WebhooksListProps {
  /**
   * Wenn gesetzt, werden a) nur account-weite und auf diese Kampagne
   * zugeschnittene Endpoints angezeigt, b) das "Neuer Webhook"-Form mit
   * dieser Kampagne vorbelegt und gesperrt.
   */
  campaignFilterId?: string | null;
  campaignFilterName?: string | null;
  /**
   * Compact-Variante (für Embedding in einem anderen Tab) — versteckt die
   * Subtitle-Sektion und nutzt eine schlankere Card.
   */
  variant?: "default" | "embedded";
}

export function WebhooksList({
  campaignFilterId,
  campaignFilterName,
  variant = "default",
}: WebhooksListProps) {
  const { toast } = useToast();

  const [rows, setRows] = React.useState<WebhookEndpoint[] | null>(null);
  const [campaigns, setCampaigns] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const [formOpen, setFormOpen] = React.useState(false);
  const [formMode, setFormMode] = React.useState<"create" | "edit">("create");
  const [formEndpoint, setFormEndpoint] =
    React.useState<WebhookEndpoint | null>(null);

  // Secret-Reveal-Modal — gleichzeitig verwendet für CREATE und ROTATE.
  const [revealSecret, setRevealSecret] = React.useState<string | null>(null);
  const [revealMode, setRevealMode] = React.useState<"create" | "rotate">(
    "create",
  );

  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [rotatingId, setRotatingId] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const [deliveriesTarget, setDeliveriesTarget] =
    React.useState<WebhookEndpoint | null>(null);

  const fetchRows = React.useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks/endpoints", { cache: "no-store" });
      if (!res.ok) {
        toast({
          title: "Konnte Webhooks nicht laden",
          description: `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as ListResponse;
      setRows(body.endpoints ?? []);
    } catch {
      toast({
        title: "Konnte Webhooks nicht laden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  const fetchCampaigns = React.useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as CampaignsResponse;
      setCampaigns(body.campaigns ?? []);
    } catch {
      // Stille — die Kampagnen-Liste ist nur fürs Dropdown im Formular.
    }
  }, []);

  React.useEffect(() => {
    void fetchRows();
    void fetchCampaigns();
  }, [fetchRows, fetchCampaigns]);

  const filteredRows = React.useMemo(() => {
    if (!rows) return null;
    if (!campaignFilterId) return rows;
    return rows.filter(
      (r) => r.campaignId === null || r.campaignId === campaignFilterId,
    );
  }, [rows, campaignFilterId]);

  // ── Aktionen ──────────────────────────────────────────────────────────────

  function openCreate() {
    setFormMode("create");
    setFormEndpoint(null);
    setFormOpen(true);
  }

  function openEdit(row: WebhookEndpoint) {
    setFormMode("edit");
    setFormEndpoint(row);
    setFormOpen(true);
  }

  async function handleTest(row: WebhookEndpoint) {
    setTestingId(row.id);
    try {
      const res = await fetch(
        `/api/webhooks/endpoints/${row.id}/test`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: number;
        latencyMs?: number;
        error?: string;
      };
      if (body.ok) {
        toast({
          title: "Test erfolgreich",
          description: `HTTP ${body.status ?? "200"}${
            typeof body.latencyMs === "number"
              ? `, ${body.latencyMs} ms`
              : ""
          }`,
          variant: "success",
        });
      } else {
        toast({
          title: "Test fehlgeschlagen",
          description:
            body.error ??
            (body.status ? `HTTP ${body.status}` : "Unbekannter Fehler"),
          variant: "danger",
        });
      }
      await fetchRows();
    } catch {
      toast({
        title: "Test fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setTestingId(null);
    }
  }

  async function handleRotateSecret(row: WebhookEndpoint) {
    setRotatingId(row.id);
    try {
      const res = await fetch(
        `/api/webhooks/endpoints/${row.id}/rotate-secret`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Secret konnte nicht rotiert werden",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as { secret?: string };
      if (!body.secret) {
        toast({
          title: "Secret konnte nicht rotiert werden",
          description: "Server-Antwort ohne Secret.",
          variant: "danger",
        });
        return;
      }
      setRevealSecret(body.secret);
      setRevealMode("rotate");
    } catch {
      toast({
        title: "Secret konnte nicht rotiert werden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setRotatingId(null);
    }
  }

  async function handleToggleActive(row: WebhookEndpoint) {
    setTogglingId(row.id);
    const isEnabling = !row.active || row.disabledAt !== null;
    const path = isEnabling ? "enable" : "disable";
    try {
      const res = await fetch(
        `/api/webhooks/endpoints/${row.id}/${path}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: isEnabling
            ? "Webhook konnte nicht aktiviert werden"
            : "Webhook konnte nicht deaktiviert werden",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: isEnabling ? "Webhook aktiviert" : "Webhook deaktiviert",
        description: row.name,
        variant: "success",
      });
      await fetchRows();
    } catch {
      toast({
        title: "Aktion fehlgeschlagen",
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
      const res = await fetch(
        `/api/webhooks/endpoints/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Löschen fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Webhook gelöscht",
        description: deleteTarget.name,
        variant: "success",
      });
      setDeleteTarget(null);
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

  // ── Render ────────────────────────────────────────────────────────────────

  const ctaLabel = campaignFilterId
    ? "Neuer Webhook für diese Kampagne"
    : "Neuer Webhook";

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">
              {variant === "embedded"
                ? "Webhooks für diese Kampagne"
                : "Webhooks"}
            </h2>
            {variant !== "embedded" && (
              <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-2xl">
                Senden Sie Lead- und Run-Events (geöffnet, abgespielt, CTA
                geklickt …) automatisch an Make.com, Zapier oder Ihren eigenen
                HTTPS-Endpunkt. Pro Endpoint wählen Sie, welche Events
                gesendet werden.
              </p>
            )}
            {variant === "embedded" && (
              <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-2xl">
                Diese Liste zeigt sowohl account-weite Webhooks als auch
                Endpoints, die nur für „{campaignFilterName ?? "diese Kampagne"}
                “ konfiguriert sind.
              </p>
            )}
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
              onClick={openCreate}
              iconLeft={<Plus className="size-4" />}
            >
              {ctaLabel}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-squircle-md bg-surface-soft px-4 py-12 text-center text-sm text-ink-muted">
            Lade Webhooks ...
          </div>
        ) : !filteredRows || filteredRows.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon />}
            title="Noch keine Webhooks angelegt"
            subtitle={
              campaignFilterId
                ? "Legen Sie einen Webhook an, um Events dieser Kampagne an einen externen Service zu schicken."
                : "Verbinden Sie VideoComet mit Zapier, Make.com oder Ihrem eigenen HTTPS-Endpunkt, um Lead- und Run-Events automatisch zu erhalten."
            }
            action={
              <Button
                onClick={openCreate}
                iconLeft={<Plus className="size-4" />}
              >
                {ctaLabel}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredRows.map((row) => (
              <WebhookCard
                key={row.id}
                row={row}
                campaigns={campaigns}
                testing={testingId === row.id}
                rotating={rotatingId === row.id}
                toggling={togglingId === row.id}
                onTest={() => handleTest(row)}
                onEdit={() => openEdit(row)}
                onRotate={() => handleRotateSecret(row)}
                onToggleActive={() => handleToggleActive(row)}
                onDelete={() => setDeleteTarget(row)}
                onOpenDeliveries={() => setDeliveriesTarget(row)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* ── Add/Edit-Dialog ─────────────────────────────────────────── */}
      <WebhookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        endpoint={formEndpoint}
        campaigns={campaigns}
        lockedCampaignId={
          formMode === "create" ? (campaignFilterId ?? null) : null
        }
        onSaved={({ endpoint, secret }) => {
          if (secret) {
            setRevealMode("create");
            setRevealSecret(secret);
          }
          // Optimistic update: neuen/aktualisierten Endpoint einfügen, dann
          // im Hintergrund frisch ziehen (deckt Server-Default-Felder ab).
          setRows((prev) => {
            if (!prev) return [endpoint];
            const idx = prev.findIndex((r) => r.id === endpoint.id);
            if (idx === -1) return [endpoint, ...prev];
            const next = prev.slice();
            next[idx] = endpoint;
            return next;
          });
          void fetchRows();
        }}
      />

      {/* ── Secret-Reveal (Create + Rotate) ─────────────────────────── */}
      <WebhookSecretReveal
        open={revealSecret !== null}
        secret={revealSecret}
        mode={revealMode}
        onClose={() => setRevealSecret(null)}
      />

      {/* ── Delete-Confirm ──────────────────────────────────────────── */}
      <DeleteWebhookDialog
        target={deleteTarget}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      {/* ── Deliveries-Drawer ───────────────────────────────────────── */}
      <DeliveriesDialog
        target={deliveriesTarget}
        onClose={() => setDeliveriesTarget(null)}
      />
    </Card>
  );
}

// ── Card pro Endpoint ──────────────────────────────────────────────────────

function WebhookCard({
  row,
  campaigns,
  testing,
  rotating,
  toggling,
  onTest,
  onEdit,
  onRotate,
  onToggleActive,
  onDelete,
  onOpenDeliveries,
}: {
  row: WebhookEndpoint;
  campaigns: Array<{ id: string; name: string }>;
  testing: boolean;
  rotating: boolean;
  toggling: boolean;
  onTest: () => void;
  onEdit: () => void;
  onRotate: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onOpenDeliveries: () => void;
}) {
  const host = React.useMemo(() => {
    try {
      return new URL(row.url).host;
    } catch {
      return row.url;
    }
  }, [row.url]);

  const status = computeStatus(row);

  const scopeLabel = React.useMemo(() => {
    if (row.campaignId === null) return "Alle Kampagnen";
    const found = campaigns.find((c) => c.id === row.campaignId);
    if (found) return found.name;
    return "Kampagne";
  }, [row.campaignId, campaigns]);

  return (
    <div className="rounded-squircle-md bg-surface-soft p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="flex items-center justify-center rounded-squircle-sm shrink-0 bg-brand-soft text-brand-deep"
          style={{ width: 48, height: 48 }}
          aria-hidden="true"
        >
          <WebhookIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-ink truncate">{row.name}</p>
            <Badge variant={row.campaignId === null ? "brand" : "neutral"}>
              {scopeLabel}
            </Badge>
          </div>
          <p
            className="text-xs text-ink-muted font-mono mt-0.5 truncate"
            title={row.url}
          >
            {host}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Aktive Events */}
      <EventBadges kinds={row.enabledEvents} />

      {/* Last-Delivery-Zeile + Disabled-Reason */}
      <div className="text-xs text-ink-muted">
        {row.disabledAt && row.disabledReason && (
          <p className="text-danger flex items-start gap-1.5 mb-1.5">
            <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{row.disabledReason}</span>
          </p>
        )}
        <p>{formatLastDelivery(row)}</p>
      </div>

      {/* Aktionen */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line-soft">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenDeliveries}
          iconLeft={<ListTree className="size-3.5" />}
        >
          Auslieferungen
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            loading={testing}
            iconLeft={<TestTube2 className="size-3.5" />}
          >
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            iconLeft={<RefreshCw className="size-3.5" />}
          >
            Bearbeiten
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Weitere Aktionen"
                className="!w-9 !px-0"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onRotate();
                }}
                disabled={rotating}
              >
                <RotateCw className="size-4" />
                Secret rotieren
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onToggleActive();
                }}
                disabled={toggling}
              >
                {row.active && !row.disabledAt ? (
                  <>
                    <Pause className="size-4" />
                    Deaktivieren
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Aktivieren
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onOpenDeliveries();
                }}
              >
                <ListTree className="size-4" />
                Auslieferungen ansehen
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                onSelect={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                <Trash2 className="size-4" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

type EndpointStatus = "ok" | "err" | "disabled" | "never";

function computeStatus(row: WebhookEndpoint): EndpointStatus {
  if (!row.active || row.disabledAt) return "disabled";
  if (row.lastDeliveryOk === true) return "ok";
  if (row.lastDeliveryOk === false) return "err";
  return "never";
}

function StatusPill({ status }: { status: EndpointStatus }) {
  if (status === "ok") {
    return (
      <Badge variant="success" dot>
        OK
      </Badge>
    );
  }
  if (status === "err") {
    return (
      <Badge variant="danger" dot>
        Fehler
      </Badge>
    );
  }
  if (status === "disabled") {
    return (
      <Badge variant="neutral" dot>
        Deaktiviert
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" dot>
      Nie versendet
    </Badge>
  );
}

function formatLastDelivery(row: WebhookEndpoint): string {
  if (!row.lastDeliveryAt) return "Noch nie versendet.";
  const when = formatRelative(row.lastDeliveryAt);
  if (row.lastDeliveryOk) return `Letzte Auslieferung ${when}: erfolgreich`;
  if (row.lastDeliveryError) {
    return `Letzte Auslieferung ${when}: ${row.lastDeliveryError}`;
  }
  return `Letzte Auslieferung ${when}: Fehler`;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "—";
    const diff = Date.now() - then;
    const min = Math.round(diff / 60_000);
    if (min < 1) return "vor wenigen Sekunden";
    if (min < 60) return `vor ${min} min`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `vor ${hrs} h`;
    const days = Math.round(hrs / 24);
    return `vor ${days} d`;
  } catch {
    return "—";
  }
}

function EventBadges({ kinds }: { kinds: WebhookEndpoint["enabledEvents"] }) {
  const MAX = 3;
  const visible = kinds.slice(0, MAX);
  const rest = kinds.length - visible.length;
  if (kinds.length === 0) {
    return (
      <p className="text-[11px] text-ink-muted italic">
        Keine Events aktiviert.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-[11px] text-ink-muted shrink-0 self-center">
        Aktive Events:
      </span>
      {visible.map((k) => {
        const meta = WEBHOOK_EVENT_LABELS[k];
        return (
          <Badge key={k} variant="brand" className="font-normal">
            {meta?.label ?? k}
          </Badge>
        );
      })}
      {rest > 0 && (
        <Badge
          variant="neutral"
          className="font-normal"
          title={kinds
            .slice(MAX)
            .map((k) => WEBHOOK_EVENT_LABELS[k]?.label ?? k)
            .join(", ")}
        >
          +{rest}
        </Badge>
      )}
    </div>
  );
}

// ── Delete-Dialog ──────────────────────────────────────────────────────────

function DeleteWebhookDialog({
  target,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: WebhookEndpoint | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = target !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Webhook löschen?</DialogTitle>
          <DialogDescription>
            Der Webhook{" "}
            <span className="font-semibold text-ink">{target?.name}</span> wird
            sofort gelöscht. Es werden keine weiteren Events an die Ziel-URL
            gesendet. Bereits geloggte Auslieferungen bleiben für 30 Tage
            einsehbar (Server-seitig).
          </DialogDescription>
        </DialogHeader>
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
            Endgültig löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Deliveries-Drawer (als großer Dialog gelöst, weil wir kein Drawer-UI haben) ─

function DeliveriesDialog({
  target,
  onClose,
}: {
  target: WebhookEndpoint | null;
  onClose: () => void;
}) {
  const open = target !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="xl" className="!max-w-4xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>Auslieferungen</DialogTitle>
              <DialogDescription className="break-words">
                {target?.name} —{" "}
                <span className="font-mono">{target?.url}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {target && (
          <WebhookDeliveriesLog endpointId={target.id} variant="full" />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} iconLeft={<X className="size-4" />}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Re-exported helpers (für Tests / Detail-Sicht) ─────────────────────────

export const __test = {
  computeStatus,
  formatRelative,
  formatLastDelivery,
};
