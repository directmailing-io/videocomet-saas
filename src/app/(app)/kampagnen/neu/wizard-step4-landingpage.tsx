"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileArchive,
  Globe,
  LayoutTemplate,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SLUG_TEMPLATE,
  renderSlugTemplate,
} from "@/lib/slug";
import { WizardReloadButton } from "./wizard-reload-button";
import { BlockTemplateThumb } from "./block-template-thumb";

interface Template {
  id: string;
  name: string;
  themeId: string;
  content: unknown;
}

interface CustomTemplate {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  thumbnailUrl: string | null;
  hasActiveVersion: boolean;
}

interface AvailableDomain {
  id: string;
  hostname: string;
  status: string;
  kind: string;
}

export interface WizardStep4Props {
  templates: Template[];
  value: string | null;
  onChange: (id: string) => void;

  // ── Custom-LP-Vorlagen (ZIP-Upload) ───────────────────────────────────────
  customTemplates: CustomTemplate[];
  customValue: string | null;
  onCustomChange: (id: string | null) => void;

  // ── Custom-Domain ─────────────────────────────────────────────────────────
  availableDomains: AvailableDomain[];
  domainId: string | null;
  onDomainChange: (id: string | null) => void;

  // ── Slug-Template ─────────────────────────────────────────────────────────
  slugTemplate: string | null;
  onSlugTemplateChange: (template: string | null) => void;

  // ── Daten-Reload (Asset im neuen Tab erstellt → hier nachladen) ──────────
  onReload?: () => void;
  reloading?: boolean;
}

const SLUG_PRESETS: Array<{ template: string; label: string }> = [
  { template: "{firstName}-{lastName}", label: "Vor- + Nachname" },
  { template: "{firstName}.{lastName}", label: "Vorname.Nachname" },
  { template: "{lastName}", label: "Nur Nachname" },
  { template: "{companyName}", label: "Firmenname" },
  { template: "{firstName}-{companyName}", label: "Vorname + Firma" },
];

const PREVIEW_LEAD = {
  firstName: "Peter",
  lastName: "Mueller",
  companyName: "Mueller GmbH",
};

const DEFAULT_HOST = "app.videocomet.de";

function domainStatusBadge(status: string): {
  label: string;
  variant: "success" | "warn" | "danger" | "neutral";
} {
  switch (status) {
    case "active":
      return { label: "Aktiv", variant: "success" };
    case "verifying":
      return { label: "DNS-Prüfung", variant: "warn" };
    case "issuing_cert":
      return { label: "SSL wird ausgestellt", variant: "warn" };
    case "pending":
      return { label: "Wartet", variant: "neutral" };
    case "failed":
      return { label: "Fehlgeschlagen", variant: "danger" };
    default:
      return { label: status, variant: "neutral" };
  }
}

export function WizardStep4Landingpage({
  templates,
  value,
  onChange,
  customTemplates,
  customValue,
  onCustomChange,
  availableDomains,
  domainId,
  onDomainChange,
  slugTemplate,
  onSlugTemplateChange,
  onReload,
  reloading,
}: WizardStep4Props) {
  // Aufgeklappt starten, wenn der User bereits vom Standard abweicht —
  // sonst bleiben die Optionen hinter „Anpassen" versteckt.
  const [urlOptionsOpen, setUrlOptionsOpen] = React.useState(
    domainId !== null || (slugTemplate !== null && slugTemplate.trim() !== ""),
  );

  // Auto-deselect domain that became inactive between page-load and step 4
  React.useEffect(() => {
    if (!domainId) return;
    const d = availableDomains.find((x) => x.id === domainId);
    if (!d || d.status !== "active") {
      onDomainChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveTemplate =
    slugTemplate && slugTemplate.trim() !== ""
      ? slugTemplate
      : DEFAULT_SLUG_TEMPLATE;

  const previewSlug = React.useMemo(
    () => renderSlugTemplate(effectiveTemplate, PREVIEW_LEAD) || "lead",
    [effectiveTemplate],
  );

  const selectedDomain = availableDomains.find((d) => d.id === domainId);
  const hostForPreview =
    selectedDomain && selectedDomain.status === "active"
      ? selectedDomain.hostname
      : null;
  const previewUrl = hostForPreview
    ? `${hostForPreview}/${previewSlug}`
    : `${DEFAULT_HOST}/v/${previewSlug}-a3f7`;

  return (
    <div className="space-y-8">
      {/* ── 1. Vorlagen-Galerie (primär) ─────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-ink">
            Landingpage-Vorlage wählen
          </p>
          {onReload && (
            <WizardReloadButton
              onReload={onReload}
              reloading={reloading ?? false}
              label="Neu laden"
              className="shrink-0"
            />
          )}
        </div>

        {templates.length === 0 && customTemplates.length === 0 ? (
          // Kein Template vorhanden → klare Anweisung + Direkt-Link in den
          // Landingpage-Editor. Der Wizard-Fortschritt wird vom parallel
          // laufenden Draft-Save (Agent C) erhalten, der User kommt also
          // zurück ohne Datenverlust.
          <EmptyState
            icon={<LayoutTemplate />}
            title="Noch keine Landingpage-Vorlage"
            subtitle="Sie benoetigen mindestens eine Landingpage-Vorlage, bevor Sie diese Kampagne fortsetzen koennen. Erstellen Sie jetzt eine — Ihr Wizard-Fortschritt bleibt erhalten."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild iconLeft={<Plus className="size-4" />}>
                  <Link href="/landingpages/neu" target="_blank">
                    Landingpage erstellen
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/landingpages">Zur Landingpage-Uebersicht</Link>
                </Button>
                {onReload && (
                  <WizardReloadButton
                    onReload={onReload}
                    reloading={reloading ?? false}
                    label="Neu laden"
                    variant="subtle"
                  />
                )}
              </div>
            }
          />
        ) : (
          <div className="space-y-6">
            {templates.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="neutral">Block</Badge>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Block-Vorlagen
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.map((tpl) => {
                    const active = tpl.id === value && !customValue;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        // onChange im Container nullt customLpTemplateId
                        // bereits atomar — kein separater onCustomChange-Call
                        // notwendig (vermeidet Stale-Closure-Bug).
                        onClick={() => onChange(tpl.id)}
                        className={cn(
                          "text-left rounded-squircle-md bg-surface shadow-card transition-all duration-200 ease-spring relative",
                          active
                            ? "ring-2 ring-brand bg-brand-soft/40"
                            : "hover:shadow-card-hover hover:-translate-y-0.5",
                        )}
                      >
                        {active && (
                          <span className="absolute top-3 right-3 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                            <Check className="size-3.5" />
                          </span>
                        )}
                        <Card className="border-0 shadow-none bg-transparent">
                          <CardContent className="p-3">
                            <div className="mb-3">
                              <BlockTemplateThumb
                                content={tpl.content}
                                themeId={tpl.themeId}
                              />
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-semibold text-ink truncate flex-1">
                                {tpl.name}
                              </p>
                              <Badge variant="neutral">Block</Badge>
                            </div>
                            <p className="text-xs text-ink-muted capitalize">
                              Theme: {tpl.themeId}
                            </p>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {customTemplates.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="brand">Custom HTML</Badge>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Eigene HTML-Vorlagen
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {customTemplates.map((tpl) => {
                    const active = tpl.id === customValue;
                    const disabled = !tpl.hasActiveVersion;
                    // Custom-Template ohne aktive Version → eigene Card mit
                    // klarem Hinweis + Link zum LP-Editor. NICHT klickbar,
                    // damit der Wizard nicht still haengen bleibt.
                    if (disabled) {
                      return (
                        <div
                          key={tpl.id}
                          className="text-left rounded-squircle-md bg-surface shadow-card p-3 relative"
                        >
                          <div className="aspect-[4/3] rounded-squircle-sm mb-3 flex items-center justify-center bg-gradient-to-br from-warn-soft to-surface-muted text-warn">
                            <AlertTriangle className="size-10 opacity-80" />
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold text-ink truncate flex-1">
                              {tpl.name}
                            </p>
                            <Badge variant="warn">Keine Version</Badge>
                          </div>
                          <p className="text-xs text-ink-muted mb-3 leading-relaxed">
                            Diese Vorlage hat noch keine aktive Version.
                            Laden Sie zuerst ein ZIP hoch oder aktivieren Sie
                            eine bestehende Version.
                          </p>
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="w-full"
                          >
                            <Link href={`/landingpages/custom/${tpl.id}`}>
                              Im Editor oeffnen
                            </Link>
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        // Atomic State-Update im Container nullt
                        // landingPageTemplateId — kein zusaetzlicher Call hier.
                        onClick={() => onCustomChange(tpl.id)}
                        className={cn(
                          "text-left rounded-squircle-md bg-surface shadow-card transition-all duration-200 ease-spring relative",
                          active
                            ? "ring-2 ring-brand bg-brand-soft/40"
                            : "hover:shadow-card-hover hover:-translate-y-0.5",
                        )}
                      >
                        {active && (
                          <span className="absolute top-3 right-3 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                            <Check className="size-3.5" />
                          </span>
                        )}
                        <Card className="border-0 shadow-none bg-transparent">
                          <CardContent className="p-3">
                            {tpl.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={tpl.thumbnailUrl}
                                alt=""
                                className="aspect-[4/3] w-full rounded-squircle-sm mb-3 object-cover object-top bg-surface-soft"
                              />
                            ) : (
                              <div className="aspect-[4/3] rounded-squircle-sm mb-3 flex items-center justify-center bg-gradient-to-br from-brand-soft to-surface-muted text-brand-deep">
                                <FileArchive className="size-10 opacity-70" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-semibold text-ink truncate flex-1">
                                {tpl.name}
                              </p>
                              <Badge variant="brand">Custom HTML</Badge>
                            </div>
                            <p className="text-xs text-ink-muted">
                              {`${tpl.versionCount} Version${
                                tpl.versionCount === 1 ? "" : "en"
                              }`}
                            </p>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 2. Web-Adresse: URL-Vorschau zuerst, Optionen hinter „Anpassen" ── */}
      <section className="rounded-squircle-md bg-surface-soft p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">Web-Adresse</p>
          <button
            type="button"
            onClick={() => setUrlOptionsOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted transition-colors"
          >
            Anpassen
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                urlOptionsOpen && "rotate-180",
              )}
            />
          </button>
        </div>

        <div className="rounded-squircle-sm bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
            <Sparkles className="size-3.5" />
            So sieht der Link pro Lead aus — Beispiel Peter Mueller
          </div>
          <p className="text-sm font-mono text-ink break-all">{previewUrl}</p>
        </div>

        {urlOptionsOpen && (
          <div className="space-y-6 pt-2">
            {/* Domain */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">
                Domain
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DomainCard
                  active={domainId === null}
                  title="VIDEOCOMET-Subdomain"
                  hostname={DEFAULT_HOST}
                  description="Standard — sofort einsatzbereit."
                  badge={{ label: "Empfohlen", variant: "brand" }}
                  selectable
                  onClick={() => onDomainChange(null)}
                />

                {availableDomains.map((d) => {
                  const badge = domainStatusBadge(d.status);
                  const isActive = d.status === "active";
                  const isSelected = d.id === domainId;
                  return (
                    <DomainCard
                      key={d.id}
                      active={isSelected}
                      title={d.kind === "apex" ? "Apex-Domain" : "Subdomain"}
                      hostname={d.hostname}
                      description={
                        isActive
                          ? "Bereit zur Auslieferung."
                          : "Noch nicht aktiv — Konfiguration in den Einstellungen abschließen."
                      }
                      badge={badge}
                      selectable={isActive}
                      onClick={() => {
                        if (isActive) onDomainChange(d.id);
                      }}
                    />
                  );
                })}
              </div>

              {availableDomains.length === 0 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Eigene Domain? Unter{" "}
                  <span className="font-semibold text-ink">
                    Einstellungen → Domains
                  </span>{" "}
                  verbinden.
                </p>
              )}
            </div>

            {/* URL-Aufbau */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                URL-Aufbau
              </p>
              <div className="flex flex-wrap gap-2">
                {SLUG_PRESETS.map((preset) => {
                  const isSelected =
                    (slugTemplate ?? DEFAULT_SLUG_TEMPLATE) ===
                    preset.template;
                  return (
                    <button
                      key={preset.template}
                      type="button"
                      onClick={() =>
                        onSlugTemplateChange(
                          preset.template === DEFAULT_SLUG_TEMPLATE
                            ? null
                            : preset.template,
                        )
                      }
                      className={cn(
                        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        isSelected
                          ? "bg-brand-soft text-brand-deep ring-1 ring-brand/40"
                          : "bg-surface text-ink-muted hover:text-ink hover:bg-surface-muted",
                      )}
                      title={preset.template}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div>
                <Label htmlFor="slug-template">Eigene Vorlage</Label>
                <Input
                  id="slug-template"
                  value={slugTemplate ?? ""}
                  placeholder={DEFAULT_SLUG_TEMPLATE}
                  onChange={(e) => {
                    const v = e.target.value;
                    onSlugTemplateChange(v.trim() === "" ? null : v);
                  }}
                  spellCheck={false}
                />
                <p className="mt-1.5 text-xs text-ink-muted">
                  Platzhalter wie{" "}
                  <code className="font-mono">{"{firstName}"}</code> werden pro
                  Lead ersetzt. Bei Namens-Kollision hängen wir einen kurzen
                  Suffix an (z.B.{" "}
                  <span className="font-mono">peter-mueller-a3f7</span>).
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── DomainCard ────────────────────────────────────────────────────────────

interface DomainCardProps {
  active: boolean;
  title: string;
  hostname: string;
  description: string;
  badge: { label: string; variant: "success" | "warn" | "danger" | "neutral" | "brand" };
  selectable: boolean;
  onClick: () => void;
}

function DomainCard({
  active,
  title,
  hostname,
  description,
  badge,
  selectable,
  onClick,
}: DomainCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!selectable}
      className={cn(
        "text-left rounded-squircle-md bg-surface shadow-card p-4 transition-all duration-200 ease-spring relative",
        selectable && active && "ring-2 ring-brand bg-brand-soft/40",
        selectable && !active && "hover:shadow-card-hover hover:-translate-y-0.5",
        !selectable &&
          "opacity-60 cursor-not-allowed bg-surface-muted shadow-none",
      )}
    >
      {active && selectable && (
        <span className="absolute top-3 right-3 z-10 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
          <Check className="size-3" />
        </span>
      )}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex size-9 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
            <Globe className="size-4" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted truncate">
            {title}
          </span>
        </div>
        <Badge variant={badge.variant} dot>
          {badge.label}
        </Badge>
      </div>
      <p className="text-sm font-mono font-semibold text-ink break-all leading-tight">
        {hostname}
      </p>
      <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
        {description}
      </p>
    </button>
  );
}
