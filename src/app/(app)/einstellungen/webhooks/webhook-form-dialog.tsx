"use client";

/**
 * Add/Edit-Dialog für Webhook-Endpoints.
 *
 * Bei `mode = "create"` ruft der Dialog beim Submit POST /api/webhooks/endpoints
 * auf und übergibt dem Caller den frisch erzeugten Endpoint + Plaintext-Secret
 * via `onSaved`. Der Caller ist dafür zuständig, das Secret im
 * `WebhookSecretReveal`-Modal anzuzeigen — der Server liefert es nur einmal.
 *
 * Bei `mode = "edit"` wird PATCH /api/webhooks/endpoints/[id] aufgerufen und
 * KEIN neues Secret zurückgegeben.
 */

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  TestTube2,
  TriangleAlert,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import type { WebhookEventKind } from "@/lib/webhooks/types";
import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_KIND_ORDER,
} from "./event-labels";
import type { WebhookEndpoint } from "./types";

export interface WebhookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  endpoint?: WebhookEndpoint | null;
  campaigns: Array<{ id: string; name: string }>;
  /** Wenn gesetzt, ist die Scope-Auswahl vorbelegt (Kampagnen-Tab) und auf
   * "Nur diese Kampagne" gesperrt. */
  lockedCampaignId?: string | null;
  /**
   * Wird nach erfolgreichem CREATE/PATCH gerufen. Bei CREATE enthält `secret`
   * den einmalig sichtbaren Plaintext-Secret — der Caller MUSS ihn dem User
   * via `WebhookSecretReveal` zeigen. Bei EDIT ist `secret` immer `null`.
   */
  onSaved: (params: {
    endpoint: WebhookEndpoint;
    secret: string | null;
  }) => void;
}

interface FormState {
  name: string;
  url: string;
  scope: "all" | "campaign";
  campaignId: string | null;
  events: Set<WebhookEventKind>;
  headers: Array<{ key: string; value: string }>;
}

interface TestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  responseExcerpt: string | null;
  error: string | null;
}

function emptyForm(): FormState {
  return {
    name: "",
    url: "",
    scope: "all",
    campaignId: null,
    events: new Set<WebhookEventKind>(["lead.opened", "lead.cta_clicked"]),
    headers: [],
  };
}

function fromEndpoint(ep: WebhookEndpoint): FormState {
  return {
    name: ep.name,
    url: ep.url,
    scope: ep.campaignId === null ? "all" : "campaign",
    campaignId: ep.campaignId,
    events: new Set(ep.enabledEvents),
    headers: Object.entries(ep.customHeaders ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  };
}

export function WebhookFormDialog({
  open,
  onOpenChange,
  mode,
  endpoint,
  campaigns,
  lockedCampaignId,
  onSaved,
}: WebhookFormDialogProps) {
  const { toast } = useToast();

  const initial = React.useMemo<FormState>(() => {
    if (mode === "edit" && endpoint) return fromEndpoint(endpoint);
    if (lockedCampaignId) {
      return { ...emptyForm(), scope: "campaign", campaignId: lockedCampaignId };
    }
    return emptyForm();
  }, [mode, endpoint, lockedCampaignId]);

  const [form, setForm] = React.useState<FormState>(initial);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [globalError, setGlobalError] = React.useState<string | null>(null);

  // Reset bei Dialog-Open/Mode-Change (mit kleinem Delay, damit der
  // Schließ-Animations-Cycle die alten Werte noch zeigt).
  React.useEffect(() => {
    if (open) {
      setForm(initial);
      setAdvancedOpen(false);
      setTestResult(null);
      setUrlError(null);
      setNameError(null);
      setGlobalError(null);
    }
  }, [open, initial]);

  function toggleEvent(kind: WebhookEventKind) {
    setForm((prev) => {
      const next = new Set(prev.events);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return { ...prev, events: next };
    });
  }

  function addHeaderRow() {
    setForm((prev) => ({
      ...prev,
      headers: [...prev.headers, { key: "", value: "" }],
    }));
  }

  function updateHeader(idx: number, patch: { key?: string; value?: string }) {
    setForm((prev) => {
      const next = prev.headers.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, headers: next };
    });
  }

  function removeHeader(idx: number) {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.filter((_, i) => i !== idx),
    }));
  }

  function buildPayload(): {
    name: string;
    url: string;
    campaignId: string | null;
    enabledEvents: WebhookEventKind[];
    customHeaders: Record<string, string>;
  } | null {
    const name = form.name.trim();
    if (!name) {
      setNameError("Bitte Name angeben.");
      return null;
    }
    setNameError(null);

    const url = form.url.trim();
    if (!url) {
      setUrlError("Bitte URL angeben.");
      return null;
    }
    if (!url.toLowerCase().startsWith("https://")) {
      setUrlError("Die URL muss mit https:// beginnen.");
      return null;
    }
    setUrlError(null);

    if (form.events.size === 0) {
      setGlobalError("Bitte mindestens ein Event auswählen.");
      return null;
    }

    const campaignId = form.scope === "all" ? null : form.campaignId;
    if (form.scope === "campaign" && !campaignId) {
      setGlobalError("Bitte eine Kampagne wählen.");
      return null;
    }

    const customHeaders: Record<string, string> = {};
    for (const row of form.headers) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k) continue;
      customHeaders[k] = v;
    }

    setGlobalError(null);
    return {
      name,
      url,
      campaignId,
      enabledEvents: Array.from(form.events),
      customHeaders,
    };
  }

  async function handleTest() {
    // Test funktioniert nur für bereits existierende Endpoints — bei "create"
    // gibt es noch keine ID, also blenden wir den Button aus.
    if (mode !== "edit" || !endpoint) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/webhooks/endpoints/${endpoint.id}/test`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as Partial<TestResult> &
        { error?: string };
      setTestResult({
        ok: Boolean(body.ok),
        status: typeof body.status === "number" ? body.status : null,
        latencyMs:
          typeof body.latencyMs === "number" ? body.latencyMs : null,
        responseExcerpt:
          typeof body.responseExcerpt === "string"
            ? body.responseExcerpt
            : null,
        error: typeof body.error === "string" ? body.error : null,
      });
    } catch {
      setTestResult({
        ok: false,
        status: null,
        latencyMs: null,
        responseExcerpt: null,
        error: "Verbindung zum Server fehlgeschlagen.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    setSubmitting(true);
    try {
      const url =
        mode === "create"
          ? "/api/webhooks/endpoints"
          : `/api/webhooks/endpoints/${endpoint?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error ?? `HTTP ${res.status}`;
        // Wenn der Server die URL als Problem markiert, blenden wir den Text
        // direkt unter dem URL-Feld ein (typische SSRF/Schema-Block-Fälle).
        if (res.status === 400 && /url|https|ssrf|loopback|privat/i.test(msg)) {
          setUrlError(msg);
        } else if (res.status === 409 && /name|exist/i.test(msg)) {
          setNameError(msg);
        } else {
          setGlobalError(msg);
        }
        return;
      }

      const body = (await res.json()) as {
        endpoint?: WebhookEndpoint;
        secret?: string;
      };
      if (!body.endpoint) {
        setGlobalError("Antwort ohne Endpoint — bitte erneut versuchen.");
        return;
      }

      toast({
        title:
          mode === "create"
            ? "Webhook angelegt"
            : "Webhook aktualisiert",
        description: body.endpoint.name,
        variant: "success",
      });

      onSaved({
        endpoint: body.endpoint,
        secret: body.secret ?? null,
      });
      onOpenChange(false);
    } catch {
      setGlobalError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  const groupedEvents = React.useMemo(() => {
    const lead: WebhookEventKind[] = [];
    const run: WebhookEventKind[] = [];
    for (const k of WEBHOOK_EVENT_KIND_ORDER) {
      if (WEBHOOK_EVENT_LABELS[k].group === "lead") lead.push(k);
      else run.push(k);
    }
    return { lead, run };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Neuer Webhook" : "Webhook bearbeiten"}
          </DialogTitle>
          <DialogDescription>
            VIDEOCOMET-Events (z.&nbsp;B. „Lead hat Landingpage geöffnet") an
            Zapier, Make oder eine eigene URL schicken.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto pr-1 -mr-1"
        >
          {/* 1. Name ─────────────────────────────────────────────────── */}
          <div>
            <Label htmlFor="webhook-name">Name</Label>
            <Input
              id="webhook-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="z.B. Make.com-Standard"
              disabled={submitting}
              error={Boolean(nameError)}
            />
            {nameError && (
              <p className="mt-1 text-xs text-danger">{nameError}</p>
            )}
          </div>

          {/* 2. URL ──────────────────────────────────────────────────── */}
          <div>
            <Label htmlFor="webhook-url">Ziel-URL</Label>
            <Input
              id="webhook-url"
              value={form.url}
              onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://hook.eu2.make.com/abc123"
              type="url"
              disabled={submitting}
              error={Boolean(urlError)}
              className="font-mono"
            />
            {urlError ? (
              <p className="mt-1 text-xs text-danger break-words">{urlError}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                Muss mit{" "}
                <span className="font-mono">https://</span> beginnen — wir
                blockieren HTTP, Loopback und private Netze.
              </p>
            )}
          </div>

          {/* 3. Scope ────────────────────────────────────────────────── */}
          <div>
            <Label>Wofür?</Label>
            <div className="flex flex-col gap-2">
              <ScopeOption
                checked={form.scope === "all"}
                disabled={Boolean(lockedCampaignId) || submitting}
                onSelect={() =>
                  setForm((p) => ({ ...p, scope: "all", campaignId: null }))
                }
                label="Für alle meine Kampagnen"
                hint="Endpoint feuert für jedes Lead-/Run-Event, das diesem Account zugeordnet ist."
              />
              <ScopeOption
                checked={form.scope === "campaign"}
                disabled={submitting}
                onSelect={() =>
                  setForm((p) => ({
                    ...p,
                    scope: "campaign",
                    campaignId: p.campaignId ?? lockedCampaignId ?? null,
                  }))
                }
                label="Nur für diese Kampagne:"
              >
                <div className="mt-2.5">
                  <Select
                    value={form.campaignId ?? ""}
                    onValueChange={(v) =>
                      setForm((p) => ({
                        ...p,
                        scope: "campaign",
                        campaignId: v || null,
                      }))
                    }
                    disabled={
                      form.scope !== "campaign" ||
                      Boolean(lockedCampaignId) ||
                      submitting
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Kampagne wählen …" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-ink-muted">
                          Keine Kampagnen vorhanden.
                        </div>
                      ) : (
                        campaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </ScopeOption>
            </div>
          </div>

          {/* 4. Events ─────────────────────────────────────────────── */}
          <div>
            <Label>Events</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <EventGroup
                title="Lead-Events"
                kinds={groupedEvents.lead}
                selected={form.events}
                disabled={submitting}
                onToggle={toggleEvent}
              />
              <EventGroup
                title="Run-Events"
                kinds={groupedEvents.run}
                selected={form.events}
                disabled={submitting}
                onToggle={toggleEvent}
              />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {form.events.size} Event(s) aktiviert. Mindestens eins ist
              Pflicht.
            </p>
          </div>

          {/* 5. Erweitert (Custom-Headers) ─────────────────────────── */}
          <div className="border-t border-line-soft pt-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-brand-deep transition-colors"
            >
              {advancedOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Erweitert
            </button>
            {advancedOpen && (
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-xs text-ink-muted">
                  Zusätzliche HTTP-Header, die mit jedem Push gesendet werden.
                  Z. B.{" "}
                  <span className="font-mono">Authorization: Bearer …</span>{" "}
                  für gesicherte Endpoints. Die VIDEOCOMET-Signatur (
                  <span className="font-mono">X-VC-Signature</span>) wird
                  zusätzlich automatisch gesetzt.
                </p>
                <div className="flex flex-col gap-2">
                  {form.headers.length === 0 && (
                    <p className="text-xs text-ink-muted italic">
                      Noch keine Custom-Header.
                    </p>
                  )}
                  {form.headers.map((row, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr,1.5fr,auto] gap-2 items-start"
                    >
                      <Input
                        value={row.key}
                        onChange={(e) =>
                          updateHeader(idx, { key: e.target.value })
                        }
                        placeholder="Header-Name"
                        disabled={submitting}
                        className="font-mono"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) =>
                          updateHeader(idx, { value: e.target.value })
                        }
                        placeholder="Wert"
                        disabled={submitting}
                        className="font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => removeHeader(idx)}
                        disabled={submitting}
                        className="!h-11 !w-11 !p-0"
                        aria-label="Header entfernen"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={addHeaderRow}
                      disabled={submitting}
                      iconLeft={<Plus className="size-3.5" />}
                    >
                      Header hinzufügen
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 6. Test-Button (nur edit) ─────────────────────────────── */}
          {mode === "edit" && endpoint && (
            <div className="border-t border-line-soft pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Test-Push</p>
                  <p className="text-xs text-ink-muted">
                    Schickt ein synthetisches Event an die aktuelle Ziel-URL.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void handleTest()}
                  loading={testing}
                  iconLeft={<TestTube2 className="size-3.5" />}
                >
                  Test ausführen
                </Button>
              </div>
              {testResult && <TestResultPanel result={testResult} />}
            </div>
          )}

          {globalError && (
            <div className="flex items-start gap-2.5 rounded-squircle-sm bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <TriangleAlert className="size-4 shrink-0 mt-0.5" />
              <p className="min-w-0 break-words">{globalError}</p>
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
              {mode === "create" ? "Webhook anlegen" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ScopeOption({
  checked,
  onSelect,
  label,
  hint,
  children,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "text-left rounded-squircle-sm border px-3.5 py-3 transition-colors",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        checked
          ? "border-brand bg-brand-soft"
          : "border-line bg-surface hover:bg-surface-muted",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 size-4 rounded-full border shrink-0 flex items-center justify-center transition-colors",
            checked
              ? "border-brand bg-brand"
              : "border-line bg-surface",
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-white" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          {hint && (
            <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
          )}
          {children}
        </div>
      </div>
    </button>
  );
}

function EventGroup({
  title,
  kinds,
  selected,
  onToggle,
  disabled,
}: {
  title: string;
  kinds: WebhookEventKind[];
  selected: Set<WebhookEventKind>;
  onToggle: (k: WebhookEventKind) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
        {title}
      </p>
      <ul className="flex flex-col">
        {kinds.map((k) => {
          const meta = WEBHOOK_EVENT_LABELS[k];
          const id = `webhook-event-${k}`;
          return (
            <li key={k}>
              <label
                htmlFor={id}
                className="flex items-center gap-2 py-1.5 cursor-pointer select-none rounded-sm hover:bg-surface-muted/40 -mx-1 px-1"
                title={meta.description}
              >
                <Checkbox
                  id={id}
                  checked={selected.has(k)}
                  onCheckedChange={() => onToggle(k)}
                  disabled={disabled}
                />
                <span className="text-sm text-ink">{meta.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TestResultPanel({ result }: { result: TestResult }) {
  const [expanded, setExpanded] = React.useState(false);
  if (result.ok) {
    return (
      <div className="mt-3 rounded-squircle-sm bg-ok-soft/60 p-3 text-sm">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="size-4 text-ok shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">
              Erfolgreich ({result.status ? `HTTP ${result.status}` : "OK"}
              {typeof result.latencyMs === "number"
                ? `, ${result.latencyMs} ms`
                : ""}
              )
            </p>
            {result.responseExcerpt && (
              <button
                type="button"
                className="mt-1 text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Antwort {expanded ? "ausblenden" : "anzeigen"}
              </button>
            )}
            {expanded && result.responseExcerpt && (
              <pre className="mt-2 rounded-squircle-sm bg-surface p-2 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-all max-h-40 overflow-auto">
                {result.responseExcerpt}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-squircle-sm bg-danger-soft/60 p-3 text-sm">
      <div className="flex items-start gap-2.5">
        <XCircle className="size-4 text-danger shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-danger">
            Fehlgeschlagen
            {result.status ? ` (HTTP ${result.status})` : ""}
            {typeof result.latencyMs === "number"
              ? `, ${result.latencyMs} ms`
              : ""}
          </p>
          {result.error && (
            <p className="mt-1 text-xs text-ink-soft break-words">
              {result.error}
            </p>
          )}
          {result.responseExcerpt && (
            <pre className="mt-2 rounded-squircle-sm bg-surface p-2 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-all max-h-32 overflow-auto">
              {result.responseExcerpt}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
