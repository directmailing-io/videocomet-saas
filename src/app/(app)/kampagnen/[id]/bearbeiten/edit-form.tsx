"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Info,
  Globe,
  LayoutTemplate,
  MonitorPlay,
  Play,
  Save,
  Sparkles,
  Video,
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
import {
  ThumbnailImageEditor,
  createDefaultThumbnailImage,
} from "@/components/editor/thumbnail-image-editor";
import type { CampaignThumbnailImage } from "@/lib/segments/types";
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
  /** Distinguishes classic webcam recordings ("webcam") from media library
   *  uploads ("video") so the picker can show a subtle badge. */
  kind: "webcam" | "video";
}

export interface EditCampaignTemplate {
  id: string;
  name: string;
  themeId: string;
}

export interface EditCampaignCustomTemplate {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  hasActiveVersion: boolean;
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
    customLpTemplateId: string | null;
    domainId: string | null;
    slugTemplate: string | null;
    /** Optionaler Tenant-Suffix für Lead-Slugs (Migration 0014). NULL = kein Suffix. */
    slugSuffix: string | null;
    pdfEnabled: boolean;
    pdfGoogleDocsUrl: string;
    pdfQrEnabled: boolean;
    pdfThumbnailEnabled: boolean;
    pdfThumbnailFrameMs: number | null;
    /**
     * Paket C — Personalisiertes Vorschaubild. Optional, weil bestehende
     * Server-Loader (vor Paket A) das Feld noch nicht selektieren. Wenn
     * undefined behandeln wir es als „nicht konfiguriert".
     */
    thumbnailImageEnabled?: boolean;
    thumbnailImage?: CampaignThumbnailImage | null;
    /**
     * Migration 0019 — Single-Source-of-Truth für die Vorschaubild-
     * Variante + globales Play-Icon-Overlay. Optional, damit ältere
     * Server-Snapshots (vor Migration) das Feld nicht zwingend liefern
     * müssen — Default-Mapping: undefined → 'frame', false.
     */
    thumbnailMode?: "frame" | "custom_image" | "landingpage_screenshot";
    thumbnailPlayIcon?: boolean;
  };
  webcams: EditCampaignWebcam[];
  templates: EditCampaignTemplate[];
  customTemplates: EditCampaignCustomTemplate[];
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
  customLpTemplateId: string | null;
  domainId: string | null;
  slugTemplate: string | null;
  slugSuffix: string | null;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
  thumbnailImageEnabled: boolean;
  thumbnailImage: CampaignThumbnailImage | null;
  thumbnailMode: "frame" | "custom_image" | "landingpage_screenshot";
  thumbnailPlayIcon: boolean;
}

type PatchBody = Partial<{
  name: string;
  mode: "webcam-only" | "with-presentation";
  webcamMediaId: string | null;
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  landingPageTemplateId: string | null;
  customLpTemplateId: string | null;
  domainId: string | null;
  slugTemplate: string | null;
  slugSuffix: string | null;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string | null;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
  thumbnailImageEnabled: boolean;
  thumbnailImage: CampaignThumbnailImage | null;
  thumbnailMode: "frame" | "custom_image" | "landingpage_screenshot";
  thumbnailPlayIcon: boolean;
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
    customLpTemplateId: data.campaign.customLpTemplateId,
    domainId: data.campaign.domainId,
    slugTemplate: data.campaign.slugTemplate,
    slugSuffix: data.campaign.slugSuffix,
    pdfEnabled: data.campaign.pdfEnabled,
    pdfGoogleDocsUrl: data.campaign.pdfGoogleDocsUrl,
    pdfQrEnabled: data.campaign.pdfQrEnabled,
    pdfThumbnailEnabled: data.campaign.pdfThumbnailEnabled,
    pdfThumbnailFrameMs: data.campaign.pdfThumbnailFrameMs,
    thumbnailImageEnabled: data.campaign.thumbnailImageEnabled ?? false,
    thumbnailImage: data.campaign.thumbnailImage ?? null,
    // Migration 0019 — Defaults für Snapshots aus der Vor-Paket-A-Welt.
    thumbnailMode: data.campaign.thumbnailMode ?? "frame",
    thumbnailPlayIcon: data.campaign.thumbnailPlayIcon ?? false,
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
          landingPageTemplateId: state.customLpTemplateId
            ? null
            : state.landingPageTemplateId,
          customLpTemplateId: state.customLpTemplateId,
          domainId: state.domainId,
          slugTemplate: state.slugTemplate,
          slugSuffix: state.slugSuffix,
          pdfEnabled: state.pdfEnabled,
          pdfGoogleDocsUrl: state.pdfGoogleDocsUrl
            ? state.pdfGoogleDocsUrl
            : null,
          pdfQrEnabled: state.pdfQrEnabled,
          pdfThumbnailEnabled: state.pdfThumbnailEnabled,
          pdfThumbnailFrameMs: state.pdfThumbnailFrameMs,
          // Paket C — Backend ignoriert, solange API-Schema noch ungepatcht.
          thumbnailImageEnabled: state.thumbnailImageEnabled,
          thumbnailImage: state.thumbnailImage,
          // Migration 0019 — Single-Source-of-Truth + Play-Icon.
          thumbnailMode: state.thumbnailMode,
          thumbnailPlayIcon: state.thumbnailPlayIcon,
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
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                          {w.durationSec != null && <span>{w.durationSec}s</span>}
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                              w.kind === "video"
                                ? "bg-surface-soft text-ink-muted"
                                : "bg-brand-soft text-brand-deep",
                            )}
                          >
                            {w.kind === "video" ? "Upload" : "Webcam"}
                          </span>
                        </div>
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
            {data.templates.length === 0 &&
            data.customTemplates.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Noch keine Vorlagen vorhanden. Legen Sie im Bereich
                Landingpages eine Vorlage an.
              </p>
            ) : (
              <LandingpageTemplateSelect
                templates={data.templates}
                customTemplates={data.customTemplates}
                blockValue={state.landingPageTemplateId}
                customValue={state.customLpTemplateId}
                onSelectBlock={(id) => {
                  setState((s) => ({
                    ...s,
                    landingPageTemplateId: id,
                    customLpTemplateId: null,
                  }));
                  void patchAndSync(
                    {
                      landingPageTemplateId: id,
                      customLpTemplateId: null,
                    },
                    "Landingpage-Vorlage",
                  );
                }}
                onSelectCustom={(id) => {
                  setState((s) => ({
                    ...s,
                    customLpTemplateId: id,
                    landingPageTemplateId: null,
                  }));
                  void patchAndSync(
                    {
                      customLpTemplateId: id,
                      landingPageTemplateId: null,
                    },
                    "Custom-LP-Vorlage",
                  );
                }}
              />
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
              suffix={state.slugSuffix}
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

        {/* Slug-Suffix (optional) */}
        <Card>
          <CardHeader>
            <CardTitle>Slug-Suffix (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <SlugSuffixField
              value={state.slugSuffix}
              onCommit={(next) => {
                setState((s) => ({ ...s, slugSuffix: next }));
                void patchAndSync({ slugSuffix: next }, "Slug-Suffix");
              }}
              onLocalChange={(next) =>
                setState((s) => ({ ...s, slugSuffix: next }))
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
              <div className="mt-5 space-y-5 pt-5 border-t border-line-soft">
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

                {/* Vorschaubild-Konfiguration ist in die untenstehende
                    Card „Vorschaubild im Brief" gewandert — dort kannst
                    du Modus (Frame / Folie / Landingpage-Screenshot) und
                    Play-Icon-Overlay einstellen. */}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vorschaubild im Brief — Edit-Spiegel der Wizard-Step-5-Logik
            (Migration 0019). Drei Modi + globales Play-Icon-Overlay; nur
            sichtbar, wenn der PDF-Brief aktiv und Thumbnail eingebettet ist. */}
        <Card>
          <CardHeader>
            <CardTitle>Vorschaubild im Brief</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Thumbnail einbetten
                </p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  Vorschaubild auf der ersten Brief-Seite. Wähle Standbild
                  aus dem Video, eine personalisierte Folie oder einen
                  automatischen Screenshot der Landingpage.
                </p>
              </div>
              <Switch
                checked={state.pdfThumbnailEnabled}
                onCheckedChange={(v) => {
                  setState((s) => ({ ...s, pdfThumbnailEnabled: v }));
                  // computed mirror für Pipeline-Code zurücksetzen, wenn off.
                  const patch: PatchBody = { pdfThumbnailEnabled: v };
                  if (!v) {
                    patch.thumbnailImageEnabled = false;
                    setState((s) => ({ ...s, thumbnailImageEnabled: false }));
                  }
                  void patchAndSync(patch, "Thumbnail");
                }}
              />
            </div>

            {state.pdfThumbnailEnabled && (
              <div className="mt-5 pt-5 border-t border-line-soft space-y-4">
                {/* 3 Modus-Karten */}
                <div
                  role="radiogroup"
                  aria-label="Thumbnail-Modus"
                  className="grid grid-cols-1 md:grid-cols-3 gap-2"
                >
                  <EditModeCard
                    active={state.thumbnailMode === "frame"}
                    onClick={() => {
                      if (state.thumbnailMode === "frame") return;
                      setState((s) => ({
                        ...s,
                        thumbnailMode: "frame",
                        thumbnailImageEnabled: false,
                      }));
                      void patchAndSync(
                        {
                          thumbnailMode: "frame",
                          thumbnailImageEnabled: false,
                        },
                        "Thumbnail-Modus",
                      );
                    }}
                    icon={<Camera className="size-4" />}
                    title="Frame aus Video wählen"
                    description="Standbild zum gewählten Zeitpunkt aus dem Video."
                  />
                  <EditModeCard
                    active={state.thumbnailMode === "custom_image"}
                    onClick={() => {
                      if (state.thumbnailMode === "custom_image") return;
                      const seed =
                        state.thumbnailImage ?? createDefaultThumbnailImage();
                      setState((s) => ({
                        ...s,
                        thumbnailMode: "custom_image",
                        thumbnailImageEnabled: true,
                        thumbnailImage: seed,
                      }));
                      void patchAndSync(
                        {
                          thumbnailMode: "custom_image",
                          thumbnailImageEnabled: true,
                          thumbnailImage: seed,
                        },
                        "Thumbnail-Modus",
                      );
                    }}
                    icon={<ImageIcon className="size-4" />}
                    title="Thumbnail-Folie gestalten"
                    description={
                      <>
                        Personalisierbar mit{" "}
                        <code className="font-mono text-brand-deep">
                          {"{{firstName}}"}
                        </code>
                        ,{" "}
                        <code className="font-mono text-brand-deep">
                          {"{{pageUrl}}"}
                        </code>
                        .
                      </>
                    }
                  />
                  <EditModeCard
                    active={state.thumbnailMode === "landingpage_screenshot"}
                    onClick={() => {
                      if (state.thumbnailMode === "landingpage_screenshot")
                        return;
                      setState((s) => ({
                        ...s,
                        thumbnailMode: "landingpage_screenshot",
                        thumbnailImageEnabled: false,
                      }));
                      void patchAndSync(
                        {
                          thumbnailMode: "landingpage_screenshot",
                          thumbnailImageEnabled: false,
                        },
                        "Thumbnail-Modus",
                      );
                    }}
                    icon={<MonitorPlay className="size-4" />}
                    title="Screenshot der Landingpage"
                    description="Automatisch erzeugt — kein Editor nötig. Zeigt die personalisierte Landingpage."
                  />
                </div>

                {/* Play-Icon-Overlay (gilt für alle 3 Modi) */}
                <label
                  className="flex items-start gap-2 cursor-pointer select-none"
                  title="Halbtransparenter Play-Button über dem Thumbnail."
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand"
                    checked={state.thumbnailPlayIcon}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setState((s) => ({ ...s, thumbnailPlayIcon: v }));
                      void patchAndSync(
                        { thumbnailPlayIcon: v },
                        "Play-Icon-Overlay",
                      );
                    }}
                  />
                  <span className="text-xs text-ink-muted italic leading-snug inline-flex items-center gap-1.5">
                    <Play className="size-3 shrink-0" />
                    Play-Icon-Overlay einblenden
                    <span className="text-ink-muted/70 not-italic">
                      — halbtransparenter Play-Button über dem Thumbnail.
                    </span>
                  </span>
                </label>

                {/* Modus-spezifischer Editor-Bereich */}
                {state.thumbnailMode === "frame" && (
                  <div className="pt-2">
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

                {state.thumbnailMode === "custom_image" &&
                  state.thumbnailImage && (
                    <div className="pt-2">
                      <ThumbnailImageEditor
                        value={state.thumbnailImage}
                        onChange={(next) => {
                          // Auto-Save bewusst NICHT pro Pixel-Tick — wir
                          // halten lokal und der „Layout speichern"-Button
                          // unten pusht den finalen Stand.
                          setState((s) => ({ ...s, thumbnailImage: next }));
                        }}
                        mediaItems={data.media.map((m) => ({
                          id: m.id,
                          name: m.name,
                          publicUrl: m.publicUrl,
                          type: m.type,
                        }))}
                      />
                      <div className="mt-4 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<Save className="size-4" />}
                          loading={savingField === "Vorschaubild-Layout"}
                          onClick={() => {
                            void patchAndSync(
                              { thumbnailImage: state.thumbnailImage },
                              "Vorschaubild-Layout",
                            );
                          }}
                        >
                          Layout speichern
                        </Button>
                      </div>
                    </div>
                  )}

                {state.thumbnailMode === "landingpage_screenshot" && (
                  <div className="pt-2">
                    <div className="rounded-squircle-sm bg-surface-soft p-4 text-xs text-ink-muted leading-relaxed">
                      Die Pipeline rendert pro Lead einen Screenshot der
                      personalisierten Landingpage und bettet ihn als
                      Thumbnail in den Brief ein. Kein weiterer Editor
                      nötig — die Vorlage ist die LP selbst.
                    </div>
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

// ── Vorschaubild-Modus-Karte ──────────────────────────────────────────────
// Spiegelt visuell die Wizard-Step-5-Karten, damit der Edit-Modus und der
// Neu-Wizard sich gleich anfühlen.

function EditModeCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "text-left rounded-squircle-sm border-2 px-3 py-3 transition-colors h-full",
        active
          ? "border-brand bg-brand-soft/40"
          : "border-line bg-surface hover:border-line-dark",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-squircle-sm",
            active ? "bg-brand text-white" : "bg-surface-muted text-ink-muted",
          )}
        >
          {icon}
        </span>
        <p className="text-sm font-semibold text-ink leading-tight">{title}</p>
      </div>
      <p className="text-[11px] text-ink-muted leading-snug">{description}</p>
    </button>
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
  suffix,
  onCommit,
  onLocalChange,
}: {
  value: string | null;
  domain: EditCampaignDomain | null;
  /** Optionaler Tenant-Suffix aus dem Slug-Suffix-Feld (Preview-Anzeige). */
  suffix: string | null;
  onCommit: (next: string | null) => void;
  onLocalChange: (next: string | null) => void;
}) {
  const effective =
    value && value.trim() !== "" ? value : DEFAULT_SLUG_TEMPLATE;
  const previewSlug = React.useMemo(() => {
    const base = renderSlugTemplate(effective, PREVIEW_LEAD) || "lead";
    const trimmedSuffix = suffix?.trim() ?? "";
    return trimmedSuffix ? `${base}-${trimmedSuffix}` : base;
  }, [effective, suffix]);
  const host =
    domain && domain.status === "active"
      ? domain.hostname
      : null;
  // Bei mehrfachem Vorkommen wird der erste Lead `…-mueller`, der zweite
  // `…-mueller-2` etc. (numerische Kollisions-Suffixe seit Paket F).
  const previewUrl = host
    ? `${host}/${previewSlug}`
    : `${DEFAULT_HOST}/v/${previewSlug}`;

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
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  selected
                    ? "bg-brand-soft text-brand-deep"
                    : "bg-surface-soft text-ink-muted hover:text-ink hover:bg-canvas-deep",
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

      <div className="rounded-squircle-sm bg-surface-soft px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
          <Sparkles className="size-3.5" />
          Live-Vorschau (mit Test-Lead Peter Mueller)
        </div>
        <p className="text-sm font-mono text-ink break-all">{previewUrl}</p>
        <p className="mt-1 text-[11px] text-ink-muted">
          Bei Namens-Kollision innerhalb derselben Kampagne wird ein
          numerischer Suffix angehaengt (z.B.{" "}
          <span className="font-mono">peter-mueller-2</span>,{" "}
          <span className="font-mono">peter-mueller-3</span> …).
        </p>
      </div>
    </div>
  );
}

// ── Slug-Suffix Feld (optional) ───────────────────────────────────────────
// Tenant-Marker, der an JEDEN Lead-Slug angehängt wird, z.B. `…-test`. Praktisch
// wenn derselbe Lead in mehreren Kampagnen unterscheidbar sein soll — drei
// Kampagnen können je einen `simon-krempel` haben (campaign-scoped Unique),
// per Suffix lassen sich diese aber auch im Pageview-Log auseinanderhalten.

/** Spiegelt die DB-CHECK-Constraint `campaigns_slug_suffix_check`. */
const SLUG_SUFFIX_RE = /^[a-z0-9-]{1,32}$/;

function SlugSuffixField({
  value,
  onCommit,
  onLocalChange,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  onLocalChange: (next: string | null) => void;
}) {
  const [touched, setTouched] = React.useState(false);
  const trimmed = (value ?? "").trim();
  const isValid = trimmed === "" || SLUG_SUFFIX_RE.test(trimmed);
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="edit-slug-suffix">Suffix</Label>
        <Input
          id="edit-slug-suffix"
          value={value ?? ""}
          placeholder="z.B. test"
          spellCheck={false}
          aria-invalid={touched && !isValid ? true : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            // Live-Normalisierung: Lowercase + nur erlaubte Zeichen, sodass
            // der User direkt sieht was im URL landet. Empty → null beim
            // Commit (siehe onBlur).
            const normalised = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
            onLocalChange(normalised === "" ? null : normalised.slice(0, 32));
          }}
          onBlur={() => {
            setTouched(true);
            const next = trimmed === "" ? null : trimmed;
            // Nur committen wenn Format passt (oder leer → null). Sonst
            // halten wir den Wert im lokalen State, bis der User korrigiert.
            if (next === null || SLUG_SUFFIX_RE.test(next)) {
              onCommit(next);
            }
          }}
        />
        <p className="mt-1.5 text-xs text-ink-muted">
          Wird an jeden Lead-Slug angehängt. Beispiel:{" "}
          <span className="font-mono">test</span> →{" "}
          <span className="font-mono">simon-krempel-test</span>. Nützlich
          wenn du den gleichen Lead in mehreren Kampagnen unterscheidbar
          machen willst. Lowercase, alphanumerisch + Bindestrich, max. 32
          Zeichen. Leer lassen für keinen Suffix.
        </p>
        {touched && !isValid && (
          <p className="mt-1 text-xs text-danger">
            Nur a-z, 0-9 und Bindestrich (max. 32 Zeichen).
          </p>
        )}
      </div>
    </div>
  );
}

// ── Landingpage-Template-Selector ─────────────────────────────────────────
// Vereint Block-Vorlagen und Custom-HTML-Vorlagen in EINEM Select. Items
// werden mit Typ-Badge versehen. Beim Setzen wird der jeweils andere
// State-Key auf null gesetzt (mutually exclusive).

function LandingpageTemplateSelect({
  templates,
  customTemplates,
  blockValue,
  customValue,
  onSelectBlock,
  onSelectCustom,
}: {
  templates: EditCampaignTemplate[];
  customTemplates: EditCampaignCustomTemplate[];
  blockValue: string | null;
  customValue: string | null;
  onSelectBlock: (id: string | null) => void;
  onSelectCustom: (id: string | null) => void;
}) {
  // Build composite value as `block:<id>` or `custom:<id>` so we can use one
  // Radix-Select.
  const composite =
    customValue !== null
      ? `custom:${customValue}`
      : blockValue !== null
        ? `block:${blockValue}`
        : "";

  function onValueChange(next: string) {
    if (next === "") {
      onSelectBlock(null);
      onSelectCustom(null);
      return;
    }
    if (next.startsWith("custom:")) {
      onSelectCustom(next.slice("custom:".length));
    } else if (next.startsWith("block:")) {
      onSelectBlock(next.slice("block:".length));
    }
  }

  return (
    <Select value={composite} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Vorlage wählen" />
      </SelectTrigger>
      <SelectContent>
        {templates.length > 0 && (
          <>
            {templates.map((tpl) => (
              <SelectItem key={`block-${tpl.id}`} value={`block:${tpl.id}`}>
                <span className="inline-flex items-center gap-2">
                  <Badge variant="neutral">Block</Badge>
                  <span>{tpl.name}</span>
                </span>
              </SelectItem>
            ))}
          </>
        )}
        {customTemplates.length > 0 && (
          <>
            {customTemplates.map((tpl) => (
              <SelectItem
                key={`custom-${tpl.id}`}
                value={`custom:${tpl.id}`}
                disabled={!tpl.hasActiveVersion}
              >
                <span className="inline-flex items-center gap-2">
                  <Badge variant="brand">Custom HTML</Badge>
                  <span>
                    {tpl.name}
                    {!tpl.hasActiveVersion && (
                      <span className="text-ink-muted">
                        {" "}
                        (noch keine Version)
                      </span>
                    )}
                  </span>
                </span>
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
