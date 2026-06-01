"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Save,
  Video,
  LayoutTemplate,
  Info,
  Globe,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { ThumbnailFramePicker } from "@/components/editor/thumbnail-frame-picker";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SLUG_TEMPLATE,
  renderSlugTemplate,
} from "@/lib/slug";

export interface EditCampaignWebcam {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

export interface EditCampaignTemplate {
  id: string;
  name: string;
  themeId: string;
}

export interface EditCampaignMedia {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

export interface EditCampaignDomain {
  id: string;
  hostname: string;
  status: string;
  kind: string;
}

export interface EditCampaignData {
  campaign: {
    id: string;
    name: string;
    mode: "webcam-only" | "with-presentation";
    webcamMediaId: string | null;
    pipPosition: "bottom-left" | "bottom-right";
    pipShape: "square" | "rounded" | "circle";
    landingPageTemplateId: string | null;
    domainId: string | null;
    slugTemplate: string | null;
    pdfEnabled: boolean;
    pdfGoogleDocsUrl: string;
    pdfQrEnabled: boolean;
    pdfThumbnailEnabled: boolean;
    pdfThumbnailFrameMs: number | null;
  };
  webcams: EditCampaignWebcam[];
  templates: EditCampaignTemplate[];
  media: EditCampaignMedia[];
  domains: EditCampaignDomain[];
}

interface FormState {
  name: string;
  mode: "webcam-only" | "with-presentation";
  webcamMediaId: string | null;
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  landingPageTemplateId: string | null;
  domainId: string | null;
  slugTemplate: string | null;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
}

type PatchBody = Partial<{
  name: string;
  mode: "webcam-only" | "with-presentation";
  webcamMediaId: string | null;
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  landingPageTemplateId: string | null;
  domainId: string | null;
  slugTemplate: string | null;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string | null;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
}>;

export function EditCampaignForm({ data }: { data: EditCampaignData }) {
  const router = useRouter();
  const { toast } = useToast();

  const [state, setState] = React.useState<FormState>({
    name: data.campaign.name,
    mode: data.campaign.mode,
    webcamMediaId: data.campaign.webcamMediaId,
    pipPosition: data.campaign.pipPosition,
    pipShape: data.campaign.pipShape,
    landingPageTemplateId: data.campaign.landingPageTemplateId,
    domainId: data.campaign.domainId,
    slugTemplate: data.campaign.slugTemplate,
    pdfEnabled: data.campaign.pdfEnabled,
    pdfGoogleDocsUrl: data.campaign.pdfGoogleDocsUrl,
    pdfQrEnabled: data.campaign.pdfQrEnabled,
    pdfThumbnailEnabled: data.campaign.pdfThumbnailEnabled,
    pdfThumbnailFrameMs: data.campaign.pdfThumbnailFrameMs,
  });

  const [saving, setSaving] = React.useState(false);
  const [savingField, setSavingField] = React.useState<string | null>(null);
  const [showWebcamPicker, setShowWebcamPicker] = React.useState(false);

  const id = data.campaign.id;

  const patchAndSync = React.useCallback(
    async (patch: PatchBody, label: string) => {
      setSavingField(label);
      try {
        const res = await fetch(`/api/campaigns/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast({
            title: "Speichern fehlgeschlagen",
            description:
              (body as { error?: string }).error ?? "Bitte erneut versuchen.",
            variant: "danger",
          });
          return false;
        }
        toast({
          title: "Gespeichert",
          description: label,
          variant: "success",
        });
        router.refresh();
        return true;
      } catch {
        toast({
          title: "Speichern fehlgeschlagen",
          description: "Verbindung zum Server fehlgeschlagen.",
          variant: "danger",
        });
        return false;
      } finally {
        setSavingField(null);
      }
    },
    [id, toast, router],
  );

  async function saveAll() {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          mode: state.mode,
          webcamMediaId: state.webcamMediaId,
          pipPosition: state.pipPosition,
          pipShape: state.pipShape,
          landingPageTemplateId: state.landingPageTemplateId,
          domainId: state.domainId,
          slugTemplate: state.slugTemplate,
          pdfEnabled: state.pdfEnabled,
          pdfGoogleDocsUrl: state.pdfGoogleDocsUrl
            ? state.pdfGoogleDocsUrl
            : null,
          pdfQrEnabled: state.pdfQrEnabled,
          pdfThumbnailEnabled: state.pdfThumbnailEnabled,
          pdfThumbnailFrameMs: state.pdfThumbnailFrameMs,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Speichern fehlgeschlagen",
          description:
            (body as { error?: string }).error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Kampagne gespeichert",
        description: "Alle Änderungen wurden übernommen.",
        variant: "success",
      });
      router.refresh();
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

  const currentWebcam = data.webcams.find(
    (w) => w.id === state.webcamMediaId,
  );

  return (
    <>
      <PageHeader
        title="Kampagne bearbeiten"
        subtitle={`Änderungen werden direkt gespeichert. (${state.name})`}
        actions={
          <>
            <Button variant="ghost" asChild iconLeft={<ArrowLeft className="size-4" />}>
              <Link href={`/kampagnen/${id}`}>Zurück</Link>
            </Button>
            <Button
              onClick={() => {
                void saveAll();
              }}
              loading={saving}
              iconLeft={<Save className="size-4" />}
            >
              Speichern
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 max-w-3xl">
        {/* Name */}
        <Card>
          <CardHeader>
            <CardTitle>Name</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="edit-name">Kampagnen-Name</Label>
                <Input
                  id="edit-name"
                  value={state.name}
                  onChange={(e) =>
                    setState((s) => ({ ...s, name: e.target.value }))
                  }
                  onBlur={() => {
                    if (
                      state.name.trim() &&
                      state.name !== data.campaign.name
                    ) {
                      void patchAndSync({ name: state.name }, "Name");
                    }
                  }}
                  placeholder="Kampagnen-Name"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (state.name.trim()) {
                    void patchAndSync({ name: state.name }, "Name");
                  }
                }}
                loading={savingField === "Name"}
                iconLeft={<Save className="size-4" />}
              >
                Speichern
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Webcam */}
        <Card>
          <CardHeader>
            <CardTitle>Webcam</CardTitle>
          </CardHeader>
          <CardContent>
            {currentWebcam ? (
              <div className="flex items-center gap-4">
                <div className="size-16 rounded-squircle-sm bg-surface-muted flex items-center justify-center text-ink-muted shrink-0">
                  <Video className="size-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {currentWebcam.name}
                  </p>
                  {currentWebcam.durationSec != null && (
                    <p className="text-xs text-ink-muted">
                      Dauer: {currentWebcam.durationSec}s
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWebcamPicker((v) => !v)}
                >
                  {showWebcamPicker ? "Schließen" : "Andere wählen"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink-muted">
                  Keine Webcam ausgewählt.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWebcamPicker((v) => !v)}
                >
                  Webcam wählen
                </Button>
              </div>
            )}
            {showWebcamPicker && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.webcams.length === 0 ? (
                  <p className="text-sm text-ink-muted col-span-full">
                    Keine Webcam-Medien vorhanden. Bitte in der Mediathek
                    anlegen.
                  </p>
                ) : (
                  data.webcams.map((w) => {
                    const active = w.id === state.webcamMediaId;
                    return (
                      <button
                        type="button"
                        key={w.id}
                        onClick={() => {
                          setState((s) => ({ ...s, webcamMediaId: w.id }));
                          setShowWebcamPicker(false);
                          void patchAndSync(
                            { webcamMediaId: w.id },
                            "Webcam",
                          );
                        }}
                        className={cn(
                          "text-left rounded-squircle-md border bg-surface p-3 transition-all relative",
                          active
                            ? "border-brand ring-2 ring-brand/30"
                            : "border-line hover:border-brand/50",
                        )}
                      >
                        {active && (
                          <span className="absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                            <Check className="size-3" />
                          </span>
                        )}
                        <p className="text-sm font-semibold text-ink truncate pr-6">
                          {w.name}
                        </p>
                        {w.durationSec != null && (
                          <p className="text-xs text-ink-muted">
                            {w.durationSec}s
                          </p>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modus */}
        <Card>
          <CardHeader>
            <CardTitle>Modus</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(
                [
                  {
                    value: "webcam-only" as const,
                    title: "Nur Webcam",
                    description:
                      "Das Webcam-Video wird unverändert versendet.",
                    icon: Video,
                  },
                  {
                    value: "with-presentation" as const,
                    title: "Mit Präsentation",
                    description:
                      "Webcam wird mit Folien, Websites oder Bildern kombiniert.",
                    icon: LayoutTemplate,
                  },
                ]
              ).map((opt) => {
                const Icon = opt.icon;
                const active = opt.value === state.mode;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (opt.value === state.mode) return;
                      setState((s) => ({ ...s, mode: opt.value }));
                      void patchAndSync({ mode: opt.value }, "Modus");
                    }}
                    className={cn(
                      "text-left rounded-squircle-md border bg-surface p-4 transition-all relative",
                      active
                        ? "border-brand ring-2 ring-brand/30"
                        : "border-line hover:border-brand/50",
                    )}
                  >
                    {active && (
                      <span className="absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                        <Check className="size-3" />
                      </span>
                    )}
                    <span className="inline-flex size-10 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep mb-2">
                      <Icon className="size-5" />
                    </span>
                    <p className="text-sm font-semibold text-ink">
                      {opt.title}
                    </p>
                    <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Segmente */}
        <Card>
          <CardHeader>
            <CardTitle>Segmente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 rounded-squircle-sm bg-brand-soft p-4">
              <Info className="size-5 text-brand-deep shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-ink">
                  Der Segment-Editor ist aktuell nur im Neu-Wizard verfügbar.
                  Eine Bearbeitung bestehender Segmente folgt in v2.
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  Tipp: Du kannst eine neue Kampagne mit angepassten
                  Segmenten anlegen und die alte löschen.
                </p>
                <div className="mt-3">
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/kampagnen/neu">Neue Kampagne anlegen</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PiP */}
        <Card>
          <CardHeader>
            <CardTitle>PiP (Picture-in-Picture)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Position</Label>
                <Select
                  value={state.pipPosition}
                  onValueChange={(v) => {
                    const pos = v as "bottom-left" | "bottom-right";
                    setState((s) => ({ ...s, pipPosition: pos }));
                    void patchAndSync({ pipPosition: pos }, "PiP-Position");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Position wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-left">Unten links</SelectItem>
                    <SelectItem value="bottom-right">Unten rechts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Form</Label>
                <Select
                  value={state.pipShape}
                  onValueChange={(v) => {
                    const shape = v as "square" | "rounded" | "circle";
                    setState((s) => ({ ...s, pipShape: shape }));
                    void patchAndSync({ pipShape: shape }, "PiP-Form");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Form wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="square">Eckig</SelectItem>
                    <SelectItem value="rounded">Abgerundet</SelectItem>
                    <SelectItem value="circle">Rund</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Landingpage-Vorlage */}
        <Card>
          <CardHeader>
            <CardTitle>Landingpage-Vorlage</CardTitle>
          </CardHeader>
          <CardContent>
            {data.templates.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Noch keine Vorlagen vorhanden. Lege im Bereich Landingpages
                eine Vorlage an.
              </p>
            ) : (
              <Select
                value={state.landingPageTemplateId ?? ""}
                onValueChange={(v) => {
                  const next = v === "" ? null : v;
                  setState((s) => ({ ...s, landingPageTemplateId: next }));
                  void patchAndSync(
                    { landingPageTemplateId: next },
                    "Landingpage-Vorlage",
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Vorlage wählen" />
                </SelectTrigger>
                <SelectContent>
                  {data.templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Custom-Domain */}
        <Card>
          <CardHeader>
            <CardTitle>Custom-Domain</CardTitle>
          </CardHeader>
          <CardContent>
            <DomainSelect
              value={state.domainId}
              domains={data.domains}
              onChange={(next) => {
                setState((s) => ({ ...s, domainId: next }));
                void patchAndSync({ domainId: next }, "Custom-Domain");
              }}
            />
          </CardContent>
        </Card>

        {/* Slug-Vorlage */}
        <Card>
          <CardHeader>
            <CardTitle>Slug-Vorlage</CardTitle>
          </CardHeader>
          <CardContent>
            <SlugTemplateField
              value={state.slugTemplate}
              domain={data.domains.find((d) => d.id === state.domainId) ?? null}
              onCommit={(next) => {
                setState((s) => ({ ...s, slugTemplate: next }));
                void patchAndSync({ slugTemplate: next }, "Slug-Vorlage");
              }}
              onLocalChange={(next) =>
                setState((s) => ({ ...s, slugTemplate: next }))
              }
            />
          </CardContent>
        </Card>

        {/* PDF */}
        <Card>
          <CardHeader>
            <CardTitle>PDF-Brief</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">
                  PDF-Brief aktivieren
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Pro Lead wird ein PDF generiert.
                </p>
              </div>
              <Switch
                checked={state.pdfEnabled}
                onCheckedChange={(v) => {
                  setState((s) => ({ ...s, pdfEnabled: v }));
                  void patchAndSync({ pdfEnabled: v }, "PDF-Brief");
                }}
              />
            </div>

            {state.pdfEnabled && (
              <div className="mt-5 space-y-5 pt-5 border-t border-line">
                <div>
                  <Label htmlFor="edit-pdf-docs">Google-Docs-URL</Label>
                  <Input
                    id="edit-pdf-docs"
                    type="url"
                    placeholder="https://docs.google.com/document/d/..."
                    value={state.pdfGoogleDocsUrl}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        pdfGoogleDocsUrl: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const value = state.pdfGoogleDocsUrl.trim();
                      void patchAndSync(
                        { pdfGoogleDocsUrl: value ? value : null },
                        "Google-Docs-URL",
                      );
                    }}
                  />
                  <p className="text-xs text-ink-muted mt-1.5">
                    Das Dokument muss öffentlich freigegeben sein.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      QR-Code einbetten
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      QR für die personalisierte Landingpage.
                    </p>
                  </div>
                  <Switch
                    checked={state.pdfQrEnabled}
                    onCheckedChange={(v) => {
                      setState((s) => ({ ...s, pdfQrEnabled: v }));
                      void patchAndSync({ pdfQrEnabled: v }, "QR-Code");
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      Thumbnail einbetten
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Standbild aus dem Video.
                    </p>
                  </div>
                  <Switch
                    checked={state.pdfThumbnailEnabled}
                    onCheckedChange={(v) => {
                      setState((s) => ({ ...s, pdfThumbnailEnabled: v }));
                      void patchAndSync(
                        { pdfThumbnailEnabled: v },
                        "Thumbnail",
                      );
                    }}
                  />
                </div>

                {state.pdfThumbnailEnabled && (
                  <div className="pt-3 border-t border-line">
                    <ThumbnailFramePicker
                      webcamMediaId={state.webcamMediaId}
                      webcamDurationSec={currentWebcam?.durationSec ?? null}
                      value={state.pdfThumbnailFrameMs}
                      onChange={(ms) => {
                        setState((s) => ({ ...s, pdfThumbnailFrameMs: ms }));
                        void patchAndSync(
                          { pdfThumbnailFrameMs: ms },
                          "Frame-Zeit",
                        );
                      }}
                      inputId="edit-pdf-frame"
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ── Custom-Domain Select ──────────────────────────────────────────────────

const DEFAULT_HOST = "app.videocomet.de";

function domainBadge(status: string): {
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
    case "failed":
      return { label: "Fehlgeschlagen", variant: "danger" };
    case "pending":
    default:
      return { label: "Wartet", variant: "neutral" };
  }
}

function DomainSelect({
  value,
  domains,
  onChange,
}: {
  value: string | null;
  domains: EditCampaignDomain[];
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Wählen Sie eine Custom-Domain oder behalten Sie die VIDEOCOMET-Standard-URL.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DomainOptionButton
          active={value === null}
          icon={<Globe className="size-4" />}
          title="VIDEOCOMET-Subdomain"
          hostname={DEFAULT_HOST}
          badge={{ label: "Standard", variant: "neutral" }}
          selectable
          onClick={() => onChange(null)}
        />
        {domains.map((d) => {
          const isActive = d.status === "active";
          const b = domainBadge(d.status);
          return (
            <DomainOptionButton
              key={d.id}
              active={value === d.id}
              icon={<Globe className="size-4" />}
              title={d.kind === "apex" ? "Apex-Domain" : "Subdomain"}
              hostname={d.hostname}
              badge={b}
              selectable={isActive}
              onClick={() => {
                if (isActive) onChange(d.id);
              }}
            />
          );
        })}
      </div>
      {domains.length === 0 && (
        <p className="text-xs text-ink-muted">
          Noch keine Custom-Domain. Sie können unter{" "}
          <span className="font-semibold text-ink">
            Einstellungen → Domains
          </span>{" "}
          eine eigene Domain hinzufügen.
        </p>
      )}
    </div>
  );
}

function DomainOptionButton({
  active,
  icon,
  title,
  hostname,
  badge,
  selectable,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  hostname: string;
  badge: { label: string; variant: "success" | "warn" | "danger" | "neutral" };
  selectable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!selectable}
      className={cn(
        "text-left rounded-squircle-md border bg-surface p-3 transition-all relative",
        selectable && active && "border-brand ring-2 ring-brand/30",
        selectable && !active && "border-line hover:border-brand/50",
        !selectable &&
          "border-line opacity-60 cursor-not-allowed bg-surface-muted",
      )}
    >
      {active && selectable && (
        <span className="absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
          <Check className="size-3" />
        </span>
      )}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex size-7 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted truncate">
          {title}
        </span>
      </div>
      <p className="text-sm font-mono font-semibold text-ink break-all leading-tight pr-6">
        {hostname}
      </p>
      <div className="mt-2">
        <Badge variant={badge.variant} dot>
          {badge.label}
        </Badge>
      </div>
    </button>
  );
}

// ── Slug-Vorlage Feld ─────────────────────────────────────────────────────

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

function SlugTemplateField({
  value,
  domain,
  onCommit,
  onLocalChange,
}: {
  value: string | null;
  domain: EditCampaignDomain | null;
  onCommit: (next: string | null) => void;
  onLocalChange: (next: string | null) => void;
}) {
  const effective =
    value && value.trim() !== "" ? value : DEFAULT_SLUG_TEMPLATE;
  const previewSlug = React.useMemo(
    () => renderSlugTemplate(effective, PREVIEW_LEAD) || "lead",
    [effective],
  );
  const host =
    domain && domain.status === "active"
      ? domain.hostname
      : null;
  const previewUrl = host
    ? `${host}/${previewSlug}`
    : `${DEFAULT_HOST}/v/${previewSlug}-a3f7`;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="edit-slug-template">Vorlage</Label>
        <Input
          id="edit-slug-template"
          value={value ?? ""}
          placeholder={DEFAULT_SLUG_TEMPLATE}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            onLocalChange(v.trim() === "" ? null : v);
          }}
          onBlur={() => {
            // Commit on blur
            onCommit(value && value.trim() !== "" ? value : null);
          }}
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
            const current = value ?? DEFAULT_SLUG_TEMPLATE;
            const selected = current === preset.template;
            return (
              <button
                key={preset.template}
                type="button"
                onClick={() => {
                  const next =
                    preset.template === DEFAULT_SLUG_TEMPLATE
                      ? null
                      : preset.template;
                  onCommit(next);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  selected
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
        <p className="text-sm font-mono text-ink break-all">{previewUrl}</p>
        <p className="mt-1 text-[11px] text-ink-muted">
          Bei Namens-Kollision wird ein 4-stelliger Hex-Suffix angehaengt (z.B.{" "}
          <span className="font-mono">peter-mueller-a3f7</span>).
        </p>
      </div>
    </div>
  );
}
