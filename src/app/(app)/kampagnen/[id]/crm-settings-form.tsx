"use client";

/**
 * CRM-Settings-Formular pro Kampagne.
 *
 * Sektionen:
 *  (a) Integration auswählen
 *  (b) Lead-Matching (Source-Target Reihen)
 *  (c) Events (page_view, video_play, cta_click) + Field-Mapping je Event
 *  (d) Statische Felder (Letzte Kampagne+Runde, Letzte Versandrunde, Letzte LP-URL)
 *  (e) Aktionen (Speichern + Test-Sync starten)
 *
 * Lese-Quellen:
 *  - GET /api/crm/integrations            → Liste der Integrations
 *  - GET /api/crm/integrations/:id/fields → CRM-Custom-Felder
 *  - GET /api/campaigns/:id/crm-settings  → bestehende Settings
 * Schreib-Aktionen:
 *  - PUT /api/campaigns/:id/crm-settings
 *  - POST /api/campaigns/:id/crm-test-sync
 *  - DELETE /api/campaigns/:id/crm-settings (CRM für Kampagne aus)
 */

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Info,
  Link as LinkIcon,
  Play,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import {
  CrmCreateFieldDialog,
  type CreatedCrmField,
} from "./crm-create-field-dialog";

// ── Typen ───────────────────────────────────────────────────────────────────

type CrmProviderId = "hubspot" | "salessuite" | "close";

interface CrmIntegrationListItem {
  id: string;
  provider: CrmProviderId;
  name: string;
  disabledAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface CrmField {
  key: string;
  label: string;
  type: "datetime" | "text" | "number" | "boolean" | "other";
  readonly: boolean;
}

const EVENT_KEYS = ["page_view", "video_play", "cta_click"] as const;
type EventKey = (typeof EVENT_KEYS)[number];

const EVENT_LABEL: Record<EventKey, string> = {
  page_view: "Landingpage-Aufruf tracken",
  video_play: "Video-Abspielklick tracken",
  cta_click: "CTA-Klick tracken",
};

const EVENT_DEFAULT_FIELD_LABEL: Record<EventKey, string> = {
  page_view: "Videocomet — Letzter Landingpage-Aufruf",
  video_play: "Videocomet — Letzter Video-Play",
  cta_click: "Videocomet — Letzter CTA-Klick",
};

const STATIC_FIELDS = [
  {
    id: "lastCampaignRound",
    label: "Letzte Kampagne + Runde",
    crmDefault: "Videocomet — Letzte Kampagne",
  },
  {
    id: "lastSendRound",
    label: "Letzte Versandrunde",
    crmDefault: "Videocomet — Letzte Versandrunde",
  },
  {
    id: "lastLandingUrl",
    label: "Letzte Landingpage-URL",
    crmDefault: "Videocomet — Letzte Landingpage-URL",
  },
] as const;

type StaticFieldId = (typeof STATIC_FIELDS)[number]["id"];

const COMMON_SOURCE_KEYS = [
  "data.email",
  "data.Email",
  "data.E-Mail",
  "data.phone",
  "data.Telefon",
];

type LeadMatchTarget = "email" | "phone";

interface LeadMatchRow {
  source: string;
  target: LeadMatchTarget;
}

/**
 * Settings-Shape, wie es PUT-Body + GET-Response erwartet. fieldMapping
 * trennen wir client-seitig in `events` (key=EventKey) und `static` (key=
 * StaticFieldId) — beim Save wird beides ineinander gemerged.
 */
interface CampaignCrmSettings {
  crmIntegrationId: string;
  enabled: boolean;
  leadMatch: LeadMatchRow[];
  enabledEvents: EventKey[];
  fieldMapping: Record<string, string>;
}

interface SettingsApiPayload {
  settings:
    | null
    | (CampaignCrmSettings & {
        integrationProvider?: CrmProviderId;
        integrationName?: string;
        integrationDisabledAt?: string | null;
      });
}

// ── Komponente ──────────────────────────────────────────────────────────────

export interface CrmSettingsFormProps {
  campaignId: string;
  campaignName: string;
  /** Callback wenn Test-Sync neue Log-Ids erzeugt hat. */
  onTestLogged?: (logIds: string[]) => void;
}

export function CrmSettingsForm({
  campaignId,
  onTestLogged,
}: CrmSettingsFormProps) {
  const { toast } = useToast();

  // ── Initial-Lade-State ───────────────────────────────────────────────
  const [loading, setLoading] = React.useState(true);
  const [integrations, setIntegrations] = React.useState<
    CrmIntegrationListItem[]
  >([]);

  // ── Settings-State ────────────────────────────────────────────────────
  const [integrationId, setIntegrationId] = React.useState<string>("");
  const [enabled, setEnabled] = React.useState(false);
  const [savedAtLeastOnce, setSavedAtLeastOnce] = React.useState(false);

  const [leadMatch, setLeadMatch] = React.useState<LeadMatchRow[]>([
    { source: "data.email", target: "email" },
  ]);

  const [enabledEvents, setEnabledEvents] = React.useState<Set<EventKey>>(
    new Set(),
  );
  const [eventMapping, setEventMapping] = React.useState<
    Record<EventKey, string>
  >({
    page_view: "",
    video_play: "",
    cta_click: "",
  });

  const [staticMapping, setStaticMapping] = React.useState<
    Record<StaticFieldId, string>
  >({
    lastCampaignRound: "",
    lastSendRound: "",
    lastLandingUrl: "",
  });

  // ── Fields (pro Integration) ─────────────────────────────────────────
  const [fields, setFields] = React.useState<CrmField[] | null>(null);
  const [fieldsLoading, setFieldsLoading] = React.useState(false);

  // ── Create-Field-Dialog State ────────────────────────────────────────
  const [createFieldOpen, setCreateFieldOpen] = React.useState(false);
  const [createFieldDefaults, setCreateFieldDefaults] = React.useState<{
    label: string;
    type: "datetime" | "text";
    assignTo: { kind: "event"; key: EventKey } | { kind: "static"; key: StaticFieldId };
  } | null>(null);

  // ── Submit / Test-State ──────────────────────────────────────────────
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    | null
    | {
        ok: boolean;
        contactsUpdated?: number;
        logIds?: string[];
        error?: string;
      }
  >(null);

  // ── Init-Load ────────────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [integRes, settingsRes] = await Promise.allSettled([
          fetch("/api/crm/integrations", { cache: "no-store" }),
          fetch(`/api/campaigns/${campaignId}/crm-settings`, {
            cache: "no-store",
          }),
        ]);
        if (cancelled) return;

        if (integRes.status === "fulfilled" && integRes.value.ok) {
          const body = (await integRes.value.json()) as {
            integrations?: CrmIntegrationListItem[];
          };
          setIntegrations(body.integrations ?? []);
        }

        if (settingsRes.status === "fulfilled" && settingsRes.value.ok) {
          const body = (await settingsRes.value.json()) as SettingsApiPayload;
          if (body.settings) {
            applySettings(body.settings);
            setSavedAtLeastOnce(true);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  // ── Apply geladene Settings auf die Form ─────────────────────────────
  function applySettings(settings: NonNullable<SettingsApiPayload["settings"]>) {
    setIntegrationId(settings.crmIntegrationId);
    setEnabled(settings.enabled);
    setLeadMatch(
      settings.leadMatch.length > 0
        ? settings.leadMatch
        : [{ source: "data.email", target: "email" }],
    );
    setEnabledEvents(new Set(settings.enabledEvents as EventKey[]));

    // fieldMapping aufteilen in events vs. static via Key-Prefix-Heuristik
    const evMap: Record<EventKey, string> = {
      page_view: "",
      video_play: "",
      cta_click: "",
    };
    const stMap: Record<StaticFieldId, string> = {
      lastCampaignRound: "",
      lastSendRound: "",
      lastLandingUrl: "",
    };
    for (const [k, v] of Object.entries(settings.fieldMapping ?? {})) {
      const value = typeof v === "string" ? v : String(v);
      if ((EVENT_KEYS as readonly string[]).includes(k)) {
        evMap[k as EventKey] = value;
      } else if (k === "lastCampaignRound" || k === "lastSendRound" || k === "lastLandingUrl") {
        stMap[k] = value;
      }
    }
    setEventMapping(evMap);
    setStaticMapping(stMap);
  }

  // ── Fields nachladen bei Integration-Wechsel ─────────────────────────
  const fetchFields = React.useCallback(async (id: string) => {
    if (!id) {
      setFields(null);
      return;
    }
    setFieldsLoading(true);
    try {
      const res = await fetch(`/api/crm/integrations/${id}/fields`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setFields([]);
        return;
      }
      const body = (await res.json()) as { fields?: CrmField[] };
      setFields(body.fields ?? []);
    } catch {
      setFields([]);
    } finally {
      setFieldsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchFields(integrationId);
  }, [integrationId, fetchFields]);

  // ── Selected integration ─────────────────────────────────────────────
  const selectedIntegration = React.useMemo(
    () => integrations.find((i) => i.id === integrationId) ?? null,
    [integrations, integrationId],
  );

  // ── Submit ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!integrationId) {
      toast({
        title: "Bitte eine Integration wählen.",
        variant: "danger",
      });
      return;
    }
    setSaving(true);
    setTestResult(null);
    try {
      const fieldMapping: Record<string, string> = {};
      for (const ek of EVENT_KEYS) {
        if (enabledEvents.has(ek) && eventMapping[ek]) {
          fieldMapping[ek] = eventMapping[ek];
        }
      }
      for (const sf of STATIC_FIELDS) {
        if (staticMapping[sf.id]) {
          fieldMapping[sf.id] = staticMapping[sf.id];
        }
      }

      const body: CampaignCrmSettings = {
        crmIntegrationId: integrationId,
        enabled,
        leadMatch: leadMatch.filter((r) => r.source.trim().length > 0),
        enabledEvents: Array.from(enabledEvents),
        fieldMapping,
      };

      const res = await fetch(`/api/campaigns/${campaignId}/crm-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Speichern fehlgeschlagen",
          description: errBody.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "CRM-Einstellungen gespeichert",
        variant: "success",
      });
      setSavedAtLeastOnce(true);
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

  async function handleDisable() {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/crm-settings`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast({
          title: "CRM-Sync konnte nicht deaktiviert werden",
          description: `HTTP ${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "CRM-Sync für diese Kampagne deaktiviert",
        variant: "success",
      });
      setSavedAtLeastOnce(false);
      setEnabled(false);
    } catch {
      toast({
        title: "CRM-Sync konnte nicht deaktiviert werden",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSync() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/crm-test-sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        contactsUpdated?: number;
        logIds?: string[];
        error?: string;
      };
      setTestResult({
        ok: Boolean(body.ok),
        contactsUpdated: body.contactsUpdated,
        logIds: body.logIds ?? [],
        error: body.error,
      });
      if (body.logIds && body.logIds.length > 0) {
        onTestLogged?.(body.logIds);
      }
    } catch {
      setTestResult({
        ok: false,
        error: "Verbindung zum Server fehlgeschlagen.",
      });
    } finally {
      setTesting(false);
    }
  }

  // ── Field-Create-Flow ────────────────────────────────────────────────
  function openCreateForEvent(eventKey: EventKey) {
    setCreateFieldDefaults({
      label: EVENT_DEFAULT_FIELD_LABEL[eventKey],
      type: "datetime",
      assignTo: { kind: "event", key: eventKey },
    });
    setCreateFieldOpen(true);
  }
  function openCreateForStatic(id: StaticFieldId) {
    const def = STATIC_FIELDS.find((s) => s.id === id);
    setCreateFieldDefaults({
      label: def?.crmDefault ?? "Videocomet — Custom-Feld",
      type: "text",
      assignTo: { kind: "static", key: id },
    });
    setCreateFieldOpen(true);
  }

  function handleFieldCreated(field: CreatedCrmField) {
    setFields((prev) => (prev ? [...prev, field] : [field]));
    if (createFieldDefaults?.assignTo.kind === "event") {
      setEventMapping((prev) => ({
        ...prev,
        [createFieldDefaults.assignTo.key as EventKey]: field.key,
      }));
    } else if (createFieldDefaults?.assignTo.kind === "static") {
      setStaticMapping((prev) => ({
        ...prev,
        [createFieldDefaults.assignTo.key as StaticFieldId]: field.key,
      }));
    }
  }

  const writableFields = React.useMemo(
    () => (fields ?? []).filter((f) => !f.readonly),
    [fields],
  );

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-squircle-md border border-line bg-surface-muted/40 px-4 py-12 text-center text-sm text-ink-muted">
        Lade CRM-Einstellungen ...
      </div>
    );
  }

  if (integrations.length === 0) {
    return (
      <div className="rounded-squircle-md border border-line bg-surface p-8 text-center">
        <Info className="mx-auto size-7 text-brand mb-3" />
        <h3 className="text-base font-semibold text-ink mb-2">
          Noch keine CRM-Integration angelegt
        </h3>
        <p className="text-sm text-ink-muted max-w-md mx-auto mb-5">
          Du hast noch keine CRM-Integration angelegt. Lege jetzt eine in den
          Einstellungen an, um Lead-Events automatisch ins CRM zu spiegeln.
        </p>
        <Button asChild iconRight={<ChevronRight className="size-4" />}>
          <Link href="/einstellungen/integrationen">
            Integration anlegen
          </Link>
        </Button>
      </div>
    );
  }

  const integrationDisabled = Boolean(selectedIntegration?.disabledAt);
  const isActive = savedAtLeastOnce && enabled && !integrationDisabled;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6">
        {isActive && (
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-ok-soft px-3 py-1.5 text-xs font-semibold text-ok">
            <CheckCircle2 className="size-3.5" />
            CRM-Sync aktiv
          </div>
        )}

        {/* (a) Integration auswählen */}
        <Section
          title="Integration auswählen"
          description="Welches CRM soll die Lead-Events erhalten?"
        >
          <div className="flex items-end gap-3 flex-wrap">
            <div className="min-w-[260px] flex-1">
              <Label htmlFor="crm-integration-select">Integration</Label>
              <Select
                value={integrationId}
                onValueChange={setIntegrationId}
              >
                <SelectTrigger id="crm-integration-select">
                  <SelectValue placeholder="Integration wählen" />
                </SelectTrigger>
                <SelectContent>
                  {integrations.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium">{i.name}</span>
                        <span className="text-[11px] text-ink-muted capitalize">
                          {i.provider}
                        </span>
                        {i.disabledAt && (
                          <Badge variant="warn">deaktiviert</Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Link
              href="/einstellungen/integrationen"
              className="text-sm font-semibold text-brand-deep hover:underline inline-flex items-center gap-1.5 mb-3"
            >
              Neue Integration anlegen
              <ChevronRight className="size-4" />
            </Link>
          </div>

          {integrationDisabled && (
            <div className="mt-3 flex items-start gap-3 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-3 py-3 text-sm text-ink">
              <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
              <p className="min-w-0">
                Diese Integration ist deaktiviert — bitte API-Key im
                Einstellungen-Bereich erneuern.
              </p>
            </div>
          )}

          {selectedIntegration && (
            <div className="mt-4 flex items-center gap-3">
              <Switch
                id="crm-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="crm-enabled" className="!mb-0 !text-sm !normal-case !tracking-normal !font-medium !text-ink">
                CRM-Sync für diese Kampagne aktivieren
              </Label>
            </div>
          )}
        </Section>

        {selectedIntegration && (
          <>
            {/* (b) Lead-Matching */}
            <Section
              title="Lead-Matching"
              description="Wir suchen den passenden CRM-Kontakt anhand dieser Felder in der angegebenen Reihenfolge."
            >
              <div className="flex flex-col gap-2">
                {leadMatch.map((row, idx) => (
                  <LeadMatchRowEditor
                    key={idx}
                    row={row}
                    onChange={(next) => {
                      setLeadMatch((prev) => {
                        const out = [...prev];
                        out[idx] = next;
                        return out;
                      });
                    }}
                    onRemove={
                      leadMatch.length > 1
                        ? () => {
                            setLeadMatch((prev) =>
                              prev.filter((_, i) => i !== idx),
                            );
                          }
                        : undefined
                    }
                  />
                ))}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconLeft={<Plus className="size-3.5" />}
                    onClick={() =>
                      setLeadMatch((prev) => [
                        ...prev,
                        { source: "", target: "email" },
                      ])
                    }
                  >
                    Fallback hinzufügen
                  </Button>
                </div>
              </div>
            </Section>

            {/* (c) Events */}
            <Section
              title="Events"
              description="Welche Lead-Aktionen sollen ans CRM gepusht werden — und in welches CRM-Feld jeweils?"
            >
              <div className="flex flex-col gap-4">
                {EVENT_KEYS.map((ek) => (
                  <EventRowEditor
                    key={ek}
                    eventKey={ek}
                    enabled={enabledEvents.has(ek)}
                    onEnabledChange={(next) => {
                      setEnabledEvents((prev) => {
                        const out = new Set(prev);
                        if (next) out.add(ek);
                        else out.delete(ek);
                        return out;
                      });
                    }}
                    fields={writableFields}
                    fieldsLoading={fieldsLoading}
                    value={eventMapping[ek]}
                    onValueChange={(v) =>
                      setEventMapping((prev) => ({ ...prev, [ek]: v }))
                    }
                    onCreateField={() => openCreateForEvent(ek)}
                    canCreateField={
                      selectedIntegration.provider !== "salessuite"
                    }
                    provider={selectedIntegration.provider}
                    tenantId={extractTenantId(selectedIntegration.metadata)}
                  />
                ))}
              </div>
            </Section>

            {/* (d) Statische Felder */}
            <Section
              title="Statische Felder"
              description="Diese Felder werden bei jedem Push aktualisiert — unabhängig vom Event."
            >
              <div className="flex flex-col gap-4">
                {STATIC_FIELDS.map((sf) => (
                  <StaticFieldEditor
                    key={sf.id}
                    label={sf.label}
                    value={staticMapping[sf.id]}
                    onValueChange={(v) =>
                      setStaticMapping((prev) => ({ ...prev, [sf.id]: v }))
                    }
                    fields={writableFields}
                    fieldsLoading={fieldsLoading}
                    onCreateField={() => openCreateForStatic(sf.id)}
                    canCreateField={
                      selectedIntegration.provider !== "salessuite"
                    }
                  />
                ))}
              </div>
            </Section>

            {/* (e) Aktionen */}
            <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-line">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  onClick={handleSave}
                  loading={saving}
                  iconLeft={<Save className="size-4" />}
                >
                  Speichern
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleTestSync}
                  loading={testing}
                  iconLeft={<Play className="size-4" />}
                  disabled={!savedAtLeastOnce}
                  title={
                    !savedAtLeastOnce
                      ? "Bitte zuerst die Einstellungen speichern."
                      : undefined
                  }
                >
                  Test-Sync starten
                </Button>
              </div>
              {savedAtLeastOnce && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDisable}
                  iconLeft={<Trash2 className="size-3.5" />}
                  className="text-danger hover:text-danger"
                >
                  CRM-Sync für diese Kampagne aus
                </Button>
              )}
            </div>

            {testResult && <TestResultPanel result={testResult} />}
          </>
        )}

        {createFieldDefaults && (
          <CrmCreateFieldDialog
            open={createFieldOpen}
            onOpenChange={setCreateFieldOpen}
            integrationId={integrationId}
            salessuiteTenantId={
              selectedIntegration
                ? extractTenantId(selectedIntegration.metadata)
                : undefined
            }
            defaultLabel={createFieldDefaults.label}
            defaultType={createFieldDefaults.type}
            onCreated={handleFieldCreated}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Sub-Komponenten ─────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && (
          <p className="text-xs text-ink-muted mt-0.5">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

function LeadMatchRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: LeadMatchRow;
  onChange: (next: LeadMatchRow) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_180px_auto] gap-2 items-center">
      <div>
        <SourceCombobox
          value={row.source}
          onChange={(v) => onChange({ ...row, source: v })}
        />
      </div>
      <span className="text-xs text-ink-muted text-center hidden sm:block">
        →
      </span>
      <div>
        <Select
          value={row.target}
          onValueChange={(v) =>
            onChange({ ...row, target: v as LeadMatchTarget })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Ziel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">E-Mail (CRM)</SelectItem>
            <SelectItem value="phone">Telefon (CRM)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            iconLeft={<X className="size-3.5" />}
            className="text-ink-muted"
            aria-label="Fallback entfernen"
          >
            Entfernen
          </Button>
        )}
      </div>
    </div>
  );
}

function SourceCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const listId = React.useId();
  return (
    <div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="data.email"
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {COMMON_SOURCE_KEYS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}

function EventRowEditor({
  eventKey,
  enabled,
  onEnabledChange,
  fields,
  fieldsLoading,
  value,
  onValueChange,
  onCreateField,
  canCreateField,
  provider,
  tenantId,
}: {
  eventKey: EventKey;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  fields: CrmField[];
  fieldsLoading: boolean;
  value: string;
  onValueChange: (v: string) => void;
  onCreateField: () => void;
  canCreateField: boolean;
  provider: CrmProviderId;
  tenantId?: string;
}) {
  const switchId = `crm-event-${eventKey}`;
  return (
    <div className="rounded-squircle-md border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
        <Label
          htmlFor={switchId}
          className="!mb-0 !text-sm !normal-case !tracking-normal !font-medium !text-ink"
        >
          {EVENT_LABEL[eventKey]}
        </Label>
      </div>
      {enabled && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <FieldCombobox
            label="In CRM-Feld schreiben"
            value={value}
            onChange={onValueChange}
            fields={fields}
            loading={fieldsLoading}
          />
          <CreateFieldButton
            canCreateField={canCreateField}
            provider={provider}
            tenantId={tenantId}
            onClick={onCreateField}
          />
        </div>
      )}
    </div>
  );
}

function StaticFieldEditor({
  label,
  value,
  onValueChange,
  fields,
  fieldsLoading,
  onCreateField,
  canCreateField,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  fields: CrmField[];
  fieldsLoading: boolean;
  onCreateField: () => void;
  canCreateField: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-3 items-end">
      <div>
        <p className="text-xs font-semibold text-ink">{label}</p>
      </div>
      <div>
        <FieldCombobox
          label=""
          value={value}
          onChange={onValueChange}
          fields={fields}
          loading={fieldsLoading}
        />
      </div>
      <CreateFieldButton
        canCreateField={canCreateField}
        onClick={onCreateField}
      />
    </div>
  );
}

function FieldCombobox({
  label,
  value,
  onChange,
  fields,
  loading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fields: CrmField[];
  loading: boolean;
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={loading || fields.length === 0}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              loading
                ? "Lade CRM-Felder ..."
                : fields.length === 0
                  ? "Keine schreibbaren Felder gefunden"
                  : "Feld wählen"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              <span className="inline-flex items-baseline gap-2">
                <span>{f.label}</span>
                <span className="font-mono text-[10px] text-ink-muted">
                  {f.key}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CreateFieldButton({
  canCreateField,
  provider,
  tenantId,
  onClick,
}: {
  canCreateField: boolean;
  provider?: CrmProviderId;
  tenantId?: string;
  onClick: () => void;
}) {
  if (canCreateField) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        iconLeft={<Plus className="size-3.5" />}
      >
        Neues Feld anlegen
      </Button>
    );
  }
  const salessuiteUrl = tenantId
    ? `https://app.salessuite.com/t/${encodeURIComponent(tenantId)}/settings/properties`
    : "https://app.salessuite.com/settings/properties";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            asChild
            iconLeft={<LinkIcon className="size-3.5" />}
            iconRight={<ExternalLink className="size-3" />}
          >
            <a href={salessuiteUrl} target="_blank" rel="noopener noreferrer">
              Feld in {provider === "salessuite" ? "Salessuite" : "CRM"} anlegen
            </a>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Custom-Fields werden direkt in Salessuite angelegt — Link öffnet die
        Property-Verwaltung.
      </TooltipContent>
    </Tooltip>
  );
}

function TestResultPanel({
  result,
}: {
  result: {
    ok: boolean;
    contactsUpdated?: number;
    logIds?: string[];
    error?: string;
  };
}) {
  if (result.ok) {
    return (
      <div className="rounded-squircle-md border border-ok/30 bg-ok-soft/30 px-4 py-3 flex items-start gap-3">
        <CheckCircle2 className="size-5 text-ok shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">
            Test-Sync erfolgreich
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            {typeof result.contactsUpdated === "number"
              ? `${result.contactsUpdated} Kontakt(e) im CRM aktualisiert.`
              : "Push-Versuch im Log dokumentiert."}
          </p>
          {result.logIds && result.logIds.length > 0 && (
            <a
              href="#crm-log"
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-deep hover:underline",
              )}
            >
              Im Log anzeigen
              <ChevronRight className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-squircle-md border border-danger/30 bg-danger-soft/30 px-4 py-3 flex items-start gap-3">
      <TriangleAlert className="size-5 text-danger shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink">Test-Sync fehlgeschlagen</p>
        <p className="text-xs text-danger mt-0.5 break-words">
          {result.error ?? "Unbekannter Fehler"}
        </p>
        {result.logIds && result.logIds.length > 0 && (
          <a
            href="#crm-log"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-deep hover:underline"
          >
            Im Log anzeigen
            <ChevronRight className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function extractTenantId(
  metadata: Record<string, unknown> | null,
): string | undefined {
  if (!metadata) return undefined;
  const t = metadata.tenantId;
  if (typeof t === "string" && t.length > 0) return t;
  return undefined;
}
