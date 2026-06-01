"use client";

import * as React from "react";
import { Check, Globe, LayoutTemplate, Sparkles } from "lucide-react";
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

interface Template {
  id: string;
  name: string;
  themeId: string;
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

  // ── Custom-Domain ─────────────────────────────────────────────────────────
  availableDomains: AvailableDomain[];
  domainId: string | null;
  onDomainChange: (id: string | null) => void;

  // ── Slug-Template ─────────────────────────────────────────────────────────
  slugTemplate: string | null;
  onSlugTemplateChange: (template: string | null) => void;
}

const THEME_PREVIEW: Record<string, string> = {
  noir: "bg-gradient-to-br from-ink to-ink-soft",
  clean: "bg-gradient-to-br from-surface to-surface-muted border border-line",
  gradient: "bg-gradient-to-br from-brand to-brand-deep",
  warm: "bg-gradient-to-br from-warn to-brand",
};

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
  availableDomains,
  domainId,
  onDomainChange,
  slugTemplate,
  onSlugTemplateChange,
}: WizardStep4Props) {
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
      {/* ── 1. Domain-Auswahl ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">
          Domain für die Landingpages
        </h2>
        <p className="text-sm text-ink-muted mb-4">
          Wählen Sie aus, unter welcher Domain die personalisierten
          Landingpages dieser Kampagne ausgeliefert werden.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Default-Option */}
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
          <div className="mt-3 text-xs text-ink-muted">
            Sie haben noch keine Custom-Domain verbunden. Sie können unter{" "}
            <span className="font-semibold text-ink">
              Einstellungen → Domains
            </span>{" "}
            eine eigene Domain hinzufügen.
          </div>
        )}
      </section>

      {/* ── 2. Slug-Vorlage ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">Slug-Vorlage</h2>
        <p className="text-sm text-ink-muted mb-4">
          Bestimmt den lesbaren Teil der URL pro Lead. Platzhalter wie{" "}
          <code className="font-mono text-xs">{"{firstName}"}</code> oder{" "}
          <code className="font-mono text-xs">{"{companyName}"}</code> werden
          aus den Lead-Daten ersetzt.
        </p>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <Label htmlFor="slug-template">Vorlage</Label>
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
                Leer lassen für den Standard{" "}
                <code className="font-mono">{DEFAULT_SLUG_TEMPLATE}</code>.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                Vorschlaege
              </p>
              <div className="flex flex-wrap gap-2">
                {SLUG_PRESETS.map((preset) => {
                  const isSelected =
                    (slugTemplate ?? DEFAULT_SLUG_TEMPLATE) === preset.template;
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
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        isSelected
                          ? "border-brand bg-brand-soft text-brand-deep"
                          : "border-line bg-surface text-ink-muted hover:text-ink hover:border-ink-muted",
                      )}
                      title={preset.template}
                    >
                      <span className="font-mono">{preset.template}</span>
                      <span className="text-[10px] opacity-70">
                        ({preset.label})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-squircle-sm border border-line bg-surface-muted/50 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                <Sparkles className="size-3.5" />
                Live-Vorschau (mit Test-Lead Peter Mueller)
              </div>
              <p className="text-sm font-mono text-ink break-all">
                {previewUrl}
              </p>
              {!hostForPreview && (
                <p className="mt-1 text-[11px] text-ink-muted">
                  Hinweis: Bei der VIDEOCOMET-Subdomain wird ein 4-stelliger
                  Hex-Suffix angehaengt (z.B.{" "}
                  <span className="font-mono">a3f7</span>).
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 text-xs text-ink-muted">
              <Globe className="size-4 shrink-0 mt-px text-ink-muted" />
              <p className="leading-relaxed">
                Bei Namens-Kollision wird ein 4-stelliger Hex-Suffix angehaengt
                (z.B. <span className="font-mono">peter-mueller-a3f7</span>).
                Leere Felder werden übersprungen.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── 3. Landingpage-Vorlage ────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">
          Landingpage-Vorlage wählen
        </h2>
        <p className="text-sm text-ink-muted mb-4">
          Diese Vorlage wird als personalisierte Landingpage für jeden Lead
          verwendet.
        </p>

        {templates.length === 0 ? (
          <EmptyState
            icon={<LayoutTemplate />}
            title="Noch keine Vorlagen"
            subtitle="Legen Sie im Bereich Landingpages eine Vorlage an, bevor Sie sie hier auswählen können."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tpl) => {
              const active = tpl.id === value;
              const preview =
                THEME_PREVIEW[tpl.themeId] ?? THEME_PREVIEW.clean;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onChange(tpl.id)}
                  className={cn(
                    "text-left rounded-squircle-md border transition-all relative",
                    active
                      ? "border-brand ring-2 ring-brand/30"
                      : "border-line hover:border-brand/50",
                  )}
                >
                  {active && (
                    <span className="absolute top-3 right-3 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3.5" />
                    </span>
                  )}
                  <Card className="border-0 shadow-none">
                    <CardContent className="p-3">
                      <div
                        className={cn(
                          "aspect-[4/3] rounded-squircle-sm mb-3",
                          preview,
                        )}
                      />
                      <p className="text-sm font-semibold text-ink truncate">
                        {tpl.name}
                      </p>
                      <p className="text-xs text-ink-muted capitalize">
                        Theme: {tpl.themeId}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
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
        "text-left rounded-squircle-md border bg-surface p-4 transition-all relative",
        selectable && active && "border-brand ring-2 ring-brand/30",
        selectable && !active && "border-line hover:border-brand/50",
        !selectable &&
          "border-line opacity-60 cursor-not-allowed bg-surface-muted",
      )}
    >
      {active && selectable && (
        <span className="absolute top-3 right-3 z-10 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
          <Check className="size-3" />
        </span>
      )}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
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
