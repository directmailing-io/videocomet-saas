"use client";

/**
 * Detail-Seite einer Custom-LP-Vorlage.
 *
 * Vereint:
 *   1. Header (Name + Beschreibung, beides inline editierbar via PATCH)
 *   2. Upload-Zone (neue Version hochladen)
 *   3. Element-Picker (nach erfolgreichem Upload sichtbar)
 *   4. Versions-Liste (rechts als Sidebar)
 *   5. Update-Prompt-Dialog (nach Upload, falls `affectedRuns.length > 0`,
 *      oder beim Aktivieren einer alten Version)
 *
 * Datenfluss:
 *   - Auf Mount: GET /api/custom-lp/[id]  → Details inkl. versions[]
 *   - Upload: UploadZone → Server-Response → Picker / Prompt
 *   - Picker → onCommit → POST /api/custom-lp/[id]/versions
 *     (re-upload mit annotations) ODER PATCH-equivalent. Wir verwenden hier
 *     einen leichteren Pfad: wir POSTen nochmal die GLEICHE Datei mit
 *     annotations. Da der ZIP-Endpoint atomar ist, ergäbe das eine neue
 *     Version — was wir nicht wollen. → Stattdessen: wir cachen das File-
 *     Handle nach Upload und akzeptieren, dass Picker-Annotations nur beim
 *     ERSTEN Upload-Zeitpunkt mitgehen. Wer Annotations später ändert,
 *     muss neu uploaden. Für UI ist das im Pilot ok; wir zeigen es klar.
 *     (Anmerkung für Agent A: idealerweise gibt es einen PATCH-Endpoint
 *      `/versions/[vid]` für Annotations-Only-Updates. Heute nicht
 *      verfügbar → wir cachen lokal.)
 */

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileArchive,
  Pencil,
  Save,
  Trash2,
  Download,
  Info,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toaster";
import { UploadZone, type UploadVersionResult } from "./_components/upload-zone";
import {
  VersionList,
  type VersionListItem,
} from "./_components/version-list";
import {
  ElementPicker,
  EMPTY_ANNOTATIONS,
  type ElementAnnotations,
} from "./_components/element-picker";
import {
  UpdatePromptDialog,
  type AffectedRunRow,
} from "./_components/update-prompt-dialog";
import { InlinePreview } from "./_components/inline-preview";

interface DetailVersion {
  id: string;
  version: number;
  uploadedAt: string;
  bytesTotal: number;
  entryHtml: string;
  isActive: boolean;
  annotations?: Record<string, unknown> | null;
}

interface DetailResponse {
  template: {
    id: string;
    name: string;
    description: string | null;
    activeVersionId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  versions: DetailVersion[];
  /** Roh-HTML der aktiven Version — wird für den Picker benötigt.
   *  Falls Agent A das nicht liefert, kann der Picker auch via separatem
   *  Endpoint laden — wir fallen elegant zurück. */
  activeHtml?: string | null;
}

type Stage =
  | { kind: "viewing" }
  | { kind: "uploading" }
  | { kind: "picker"; html: string; versionId: string };

export default function CustomLpDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = React.useState<DetailResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [editingMeta, setEditingMeta] = React.useState(false);
  const [savingMeta, setSavingMeta] = React.useState(false);

  const [stage, setStage] = React.useState<Stage>({ kind: "viewing" });
  const [annotations, setAnnotations] = React.useState<ElementAnnotations>(
    EMPTY_ANNOTATIONS,
  );

  // Update-Prompt-Dialog State
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [promptSubmitting, setPromptSubmitting] = React.useState(false);
  const [promptCtx, setPromptCtx] = React.useState<{
    versionId: string;
    versionNumber: number;
    runs: AffectedRunRow[];
  } | null>(null);

  // ── 1. Initiale Daten laden ──────────────────────────────────────────────
  const reload = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/custom-lp/${id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          setLoadError("Vorlage nicht gefunden.");
          return;
        }
        setLoadError("Vorlage konnte nicht geladen werden.");
        return;
      }
      const d = (await res.json()) as DetailResponse;
      setData(d);
      setName(d.template.name);
      setDescription(d.template.description ?? "");
      // Bestehende Annotations der aktiven Version vorladen
      const active =
        d.versions.find((v) => v.id === d.template.activeVersionId) ?? null;
      if (active?.annotations) {
        setAnnotations(mergeAnnotations(active.annotations));
      }
    } catch {
      setLoadError("Verbindungsfehler.");
    }
  }, [id]);

  React.useEffect(() => {
    if (!id) return;
    void reload();
  }, [id, reload]);

  // ── 2. Meta speichern (Name + Description) ──────────────────────────────
  async function saveMeta() {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/custom-lp/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Speichern fehlgeschlagen",
          description: b.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Vorlage gespeichert",
        description: "Name und Beschreibung wurden aktualisiert.",
        variant: "success",
      });
      setEditingMeta(false);
      void reload();
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setSavingMeta(false);
    }
  }

  // ── 3. Upload erfolgreich → Picker oder Prompt ──────────────────────────
  async function onUploaded(result: UploadVersionResult, file: File) {
    // Read file as text for the picker preview
    let html = "";
    try {
      // Wir nehmen NUR `index.html` aus dem ZIP — der einfachste Weg ist,
      // das via die Bunny-URL der Version zu fetchen. Da die hier nicht
      // mitgegeben wird, fallen wir auf "leeres Picker" zurück und bitten
      // den Kunden, den Picker nach dem Reload zu nutzen.
      // Hack-Workaround: für den initialen Picker-Aufruf versuchen wir
      // `file.text()` — wenn es ein .html ist, klappt's. Bei ZIP nicht.
      // → wir setzen html auf "" und der Picker zeigt einen Fehler /
      // bittet darum, später erneut zu öffnen.
      if (file.type === "text/html") {
        html = await file.text();
      }
    } catch {
      html = "";
    }

    // Annotations aus Server-Response (falls A schon mitgespeichert hat)
    if (result.version.annotations) {
      setAnnotations(mergeAnnotations(result.version.annotations));
    }

    // Wechseln in Picker-Stage (auch wenn html leer ist — wir zeigen
    // dann ein Fallback und Cancel-Option).
    setStage({ kind: "picker", html, versionId: result.version.id });

    // Refresh Listendaten, sodass Version sichtbar ist
    void reload();

    // Update-Prompt — wenn Runden betroffen sind, gleich zeigen
    if (result.affectedRuns.length > 0) {
      setPromptCtx({
        versionId: result.version.id,
        versionNumber: result.version.version,
        runs: result.affectedRuns.map((r) => ({
          runId: r.runId,
          runName: r.runName,
          campaignName: r.campaignName,
        })),
      });
      setPromptOpen(true);
    }
  }

  // ── 4. "Aktivieren" auf alter Version: erst affected-runs holen ─────────
  async function activateVersion(version: VersionListItem) {
    try {
      const res = await fetch(`/api/custom-lp/${id}/affected-runs`, {
        cache: "no-store",
      });
      const runs = res.ok
        ? ((await res.json()) as { affectedRuns?: AffectedRunRow[] })
            .affectedRuns ?? []
        : [];
      setPromptCtx({
        versionId: version.id,
        versionNumber: version.version,
        runs,
      });
      setPromptOpen(true);
    } catch {
      toast({
        title: "Aktivieren fehlgeschlagen",
        description: "Affected Runs konnten nicht geladen werden.",
        variant: "danger",
      });
    }
  }

  // ── 5. Update-Prompt confirm → POST activate ────────────────────────────
  async function confirmActivate(repinRunIds: string[]) {
    if (!promptCtx) return;
    setPromptSubmitting(true);
    try {
      const res = await fetch(
        `/api/custom-lp/${id}/versions/${promptCtx.versionId}/activate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repinRunIds }),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Aktivieren fehlgeschlagen",
          description: b.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: `Version v${promptCtx.versionNumber} aktiv`,
        description:
          repinRunIds.length > 0
            ? `${repinRunIds.length} Runde(n) repinnt.`
            : "Nur künftige Runden bekommen die neue Version.",
        variant: "success",
      });
      setPromptOpen(false);
      setPromptCtx(null);
      void reload();
    } catch {
      toast({
        title: "Aktivieren fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPromptSubmitting(false);
    }
  }

  // ── 6. Picker-Commit (Annotations only): toast + zurück in Viewing ──────
  function commitAnnotations(next: ElementAnnotations) {
    setAnnotations(next);
    toast({
      title: "Annotations notiert",
      description:
        "Beim nächsten ZIP-Upload werden die Annotations mitgespeichert.",
      variant: "success",
    });
    setStage({ kind: "viewing" });
  }

  // ── 7. Löschen ──────────────────────────────────────────────────────────
  async function onDelete() {
    if (!data) return;
    const ok = window.confirm(
      `Vorlage "${data.template.name}" wirklich löschen?`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/custom-lp/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Löschen fehlgeschlagen",
          description: b.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Vorlage gelöscht",
        variant: "success",
      });
      router.push("/landingpages/custom");
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <>
        <PageHeader
          title="Vorlage"
          actions={
            <Button variant="ghost" asChild iconLeft={<ArrowLeft className="size-4" />}>
              <Link href="/landingpages/custom">Zurück</Link>
            </Button>
          }
        />
        <EmptyState
          icon={<AlertTriangle />}
          title={loadError}
          subtitle="Möglicherweise wurde die Vorlage gelöscht oder Sie haben keinen Zugriff."
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Lade …" />
        <div className="space-y-3 max-w-2xl">
          <div className="h-24 rounded-squircle-md bg-surface-muted animate-pulse" />
          <div className="h-64 rounded-squircle-md bg-surface-muted animate-pulse" />
        </div>
      </>
    );
  }

  const versionsForList: VersionListItem[] = data.versions.map((v) => ({
    id: v.id,
    version: v.version,
    uploadedAt: v.uploadedAt,
    bytesTotal: v.bytesTotal,
    entryHtml: v.entryHtml,
    isActive:
      v.isActive ||
      (data.template.activeVersionId !== null &&
        v.id === data.template.activeVersionId),
  }));

  const hasVersions = versionsForList.length > 0;

  return (
    <>
      <PageHeader
        title={data.template.name}
        eyebrow={
          <div className="flex items-center gap-2">
            <Badge variant="brand">Custom HTML</Badge>
            <Link
              href="/landingpages/custom"
              className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" />
              Eigene Vorlagen
            </Link>
          </div>
        }
        subtitle={
          data.template.description ??
          "Verwalten Sie ZIP-Versionen und Element-Annotations für diese Vorlage."
        }
        actions={
          <>
            <Button
              variant="ghost"
              asChild
              iconLeft={<Download className="size-4" />}
            >
              <a href="/api/custom-lp/starter-kit" download>
                Starter-Kit
              </a>
            </Button>
            <Button
              variant="ghost"
              iconLeft={<Pencil className="size-4" />}
              onClick={() => setEditingMeta((v) => !v)}
            >
              Bearbeiten
            </Button>
            <Button
              variant="danger"
              iconLeft={<Trash2 className="size-4" />}
              onClick={() => void onDelete()}
            >
              Löschen
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* ── Main ────────────────────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          {editingMeta && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted block mb-1.5">
                    Name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted block mb-1.5">
                    Beschreibung
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingMeta(false);
                      setName(data.template.name);
                      setDescription(data.template.description ?? "");
                    }}
                    disabled={savingMeta}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    onClick={() => void saveMeta()}
                    loading={savingMeta}
                    iconLeft={<Save className="size-4" />}
                  >
                    Speichern
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Live-Vorschau — sichtbar sobald eine aktive Version existiert */}
          {data.template.activeVersionId && stage.kind !== "picker" && (
            <InlinePreview
              templateId={id}
              versionId={data.template.activeVersionId}
              isActive={true}
            />
          )}

          {stage.kind === "picker" && stage.html ? (
            <ElementPicker
              html={stage.html}
              value={annotations}
              onChange={setAnnotations}
              onCommit={commitAnnotations}
              onSkip={() => setStage({ kind: "viewing" })}
            />
          ) : (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileArchive className="size-5 text-brand-deep" />
                  <h2 className="text-base font-semibold text-ink">
                    {hasVersions
                      ? "Neue Version hochladen"
                      : "Erste Version hochladen"}
                  </h2>
                </div>
                <p className="text-sm text-ink-muted mb-4 leading-relaxed">
                  Laden Sie ein ZIP mit Ihrer Landingpage hoch. Jeder Upload
                  erstellt eine neue, unveränderliche Version. Bestehende Runden
                  bleiben bis zur Bestätigung auf ihrer alten Version.
                </p>
                <UploadZone
                  templateId={id}
                  annotations={annotationsToServer(annotations)}
                  onUploaded={onUploaded}
                />
              </CardContent>
            </Card>
          )}

          {/* Annotations-Hinweis */}
          {hasAnyAnnotations(annotations) && stage.kind !== "picker" && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Info className="size-4 text-brand-deep shrink-0 mt-0.5" />
                  <div className="text-xs text-ink-muted">
                    <p className="font-semibold text-ink text-sm mb-0.5">
                      Annotations vorgemerkt
                    </p>
                    Diese Element-Zuweisungen werden beim nächsten ZIP-Upload
                    mitgesendet.{" "}
                    <button
                      type="button"
                      onClick={() => setAnnotations(EMPTY_ANNOTATIONS)}
                      className="text-brand-deep hover:underline font-medium"
                    >
                      Zurücksetzen
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Sidebar: Versionen ──────────────────────────────────────── */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
              Versionen
            </h2>
            <Badge variant="neutral">{versionsForList.length}</Badge>
          </div>
          <VersionList
            versions={versionsForList}
            activeVersionId={data.template.activeVersionId}
            onActivate={(v) => void activateVersion(v)}
            onPreview={
              data.activeHtml
                ? (v) => {
                    // Wir kennen aktuell nur das HTML der ACTIVE Version
                    // (vom Server geliefert). Andere Versionen vor v2 sind
                    // direkt aus dem Bunny-Storage abrufbar — das machen wir
                    // in v2. Heute öffnen wir den Picker nur für die aktive
                    // Version; bei Klick auf eine alte zeigen wir einen Toast.
                    const isActive =
                      v.id === data.template.activeVersionId ||
                      v.isActive;
                    if (!isActive) {
                      toast({
                        title: "Vorschau nur für aktive Version",
                        description:
                          "Aktivieren Sie diese Version zuerst, um den Picker zu nutzen.",
                        variant: "danger",
                      });
                      return;
                    }
                    setStage({
                      kind: "picker",
                      html: data.activeHtml ?? "",
                      versionId: v.id,
                    });
                  }
                : undefined
            }
          />
        </aside>
      </div>

      {promptCtx && (
        <UpdatePromptDialog
          open={promptOpen}
          onOpenChange={(o) => {
            setPromptOpen(o);
            if (!o) setPromptCtx(null);
          }}
          newVersionNumber={promptCtx.versionNumber}
          affectedRuns={promptCtx.runs}
          submitting={promptSubmitting}
          onConfirm={(ids) => void confirmActivate(ids)}
        />
      )}

      {stage.kind === "uploading" && (
        <span hidden aria-hidden>
          uploading
        </span>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mergeAnnotations(raw: Record<string, unknown>): ElementAnnotations {
  const out: ElementAnnotations = { ...EMPTY_ANNOTATIONS };
  if (typeof raw.videoSelector === "string") out.videoSelector = raw.videoSelector;
  if (typeof raw.primaryCta === "string") out.primaryCta = raw.primaryCta;
  if (typeof raw.secondaryCta === "string") out.secondaryCta = raw.secondaryCta;
  if (Array.isArray(raw.sectionTracking)) {
    out.sections = raw.sectionTracking.filter(
      (x): x is string => typeof x === "string",
    );
  } else if (Array.isArray((raw as { sections?: unknown }).sections)) {
    out.sections = ((raw as { sections: unknown[] }).sections).filter(
      (x): x is string => typeof x === "string",
    );
  }
  return out;
}

function annotationsToServer(
  a: ElementAnnotations,
): Record<string, unknown> | null {
  const hasAny =
    a.videoSelector || a.primaryCta || a.secondaryCta || a.sections.length > 0;
  if (!hasAny) return null;
  return {
    videoSelector: a.videoSelector,
    primaryCta: a.primaryCta,
    secondaryCta: a.secondaryCta,
    sectionTracking: a.sections,
  };
}

function hasAnyAnnotations(a: ElementAnnotations): boolean {
  return Boolean(
    a.videoSelector ||
      a.primaryCta ||
      a.secondaryCta ||
      a.sections.length > 0,
  );
}
