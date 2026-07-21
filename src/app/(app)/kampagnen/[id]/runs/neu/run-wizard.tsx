"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Upload,
  Globe,
  FileSpreadsheet,
  Play,
  ChevronDown,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UrlPicker } from "@/components/media-urls/url-picker";
import { RunCostEstimate } from "@/components/billing/run-cost-estimate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RunWizardStepPlaceholders } from "./run-wizard-step-placeholders";
import {
  RUN_WIZARD_DEDUPE_DEFAULT,
  RunWizardDedupeCard,
} from "./run-wizard-dedupe-card";
import { detectDuplicates } from "@/lib/dedupe/engine";
import type { DedupeConfig } from "@/lib/dedupe/types";
import { MultiTabPicker, type SelectedTab, type SheetTabInfo } from "./tab-picker";
import { AbSplitPicker, type AbSplitMode } from "@/components/ab/ab-split-picker";

export interface RunWizardProps {
  campaignId: string;
  campaignName: string;
  pdfEnabled: boolean;
  /**
   * true wenn der Brief-A/B-Test der Kampagne startklar ist (aktiviert +
   * beide Google-Docs-URLs hinterlegt). Dann zeigt Step 3 die Split-Regel
   * und der Start-POST schickt `{ab:{mode,weightA}}` mit.
   */
  abTestingActive: boolean;
  /**
   * Standard-Verteilung der Kampagne (Migration 0035) — befüllt die
   * Split-Regel in Step 3 vor; pro Runde weiterhin überschreibbar.
   */
  abDefaultMode: AbSplitMode;
  abDefaultWeightA: number;
  /**
   * Fortsetzen einer unfertigen Runde (Status draft/mapping): der Server
   * rekonstruiert Preview + Legacy-Mapping aus `runs.column_mapping` und
   * der Wizard startet direkt in Step 1. Der Platzhalter-Mapping-Step lädt
   * sein gespeichertes Mapping selbst über GET /api/runs/[id]/placeholders.
   */
  resume?: RunWizardResume;
}

export interface RunWizardResume {
  runId: string;
  runName: string;
  preview: ParsedPreview | null;
  mapping: Record<string, string>;
  dedupeConfig: DedupeConfig | null;
}

export interface ParsedPreview {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  truncated?: boolean;
}

const STEPS = ["Adressliste", "Vorschau & Duplikate", "Mapping", "Starten"];

// Standard placeholders we always offer; campaigns may bring more via the
// google-docs placeholders, but for v1 we use this baseline.
const STANDARD_PLACEHOLDERS = [
  { key: "firstName", label: "Vorname" },
  { key: "lastName", label: "Nachname" },
  { key: "company", label: "Firma" },
  { key: "website", label: "Website" },
  { key: "email", label: "E-Mail" },
];

export function RunWizard({
  campaignId,
  campaignName,
  pdfEnabled,
  abTestingActive,
  abDefaultMode,
  abDefaultWeightA,
  resume,
}: RunWizardProps) {
  const router = useRouter();

  const [step, setStep] = React.useState(resume?.preview ? 1 : 0);
  const [runName, setRunName] = React.useState(
    resume?.runName ?? `Runde ${new Date().toLocaleDateString("de-DE")}`,
  );
  const [runId, setRunId] = React.useState<string | null>(
    resume?.runId ?? null,
  );
  const [creating, setCreating] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Billing-Gate: der Estimate-Component setzt das je nach Balance +
  // Subscription-Status. Wenn false, disable'n wir den Start-Button.
  const [billingReady, setBillingReady] = React.useState(true);

  const [uploadKind, setUploadKind] = React.useState<"file" | "google">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ParsedPreview | null>(
    resume?.preview ?? null,
  );

  // ── Multi-Tab-State (nur für Google Sheets mit mehreren Untertabellen) ──
  // Wenn der User eine URL zu einem Multi-Tab-Sheet paste, zeigen wir einen
  // Tab-Picker VOR Step 1. Er wählt welche Tabs verarbeitet werden — für
  // jede Auswahl wird beim Submit eine eigene Runde gespawned.
  const [tabPickerVisible, setTabPickerVisible] = React.useState(false);
  const [sheetTabs, setSheetTabs] = React.useState<SheetTabInfo[]>([]);
  const [spreadsheetTitle, setSpreadsheetTitle] = React.useState<string>("");
  const [selectedTabs, setSelectedTabs] = React.useState<SelectedTab[]>([]);
  const bulkMode = selectedTabs.length > 1;

  const [mapping, setMapping] = React.useState<Record<string, string>>(
    resume?.mapping ?? {},
  );

  // ── A/B-Split-Regel (nur relevant wenn abTestingActive) ───────────────
  // Vorbefüllt mit der Standard-Verteilung der Kampagne; pro Runde
  // überschreibbar — der Start friert die effektive Regel als Snapshot ein.
  const [abMode, setAbMode] = React.useState<AbSplitMode>(
    abDefaultMode,
  );
  const [abWeightA, setAbWeightA] = React.useState(abDefaultWeightA);

  /**
   * Request-Init für POST /api/runs/[id]/start. Bei aktivem A/B-Test wird
   * die Split-Regel mitgeschickt — das Backend friert sie zusammen mit
   * beiden Brief-URLs als Snapshot in `runs.ab_config` ein.
   */
  function startRequestInit(): RequestInit {
    if (!abTestingActive) return { method: "POST" };
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ab: { mode: abMode, weightA: abWeightA } }),
    };
  }

  /**
   * Dedupe-Config für die Card "Duplikate erkennen". Default: enabled mit
   * `keep-first`-Strategie und LEEREN Regeln — die Card ruft beim ersten
   * Mount selbst `suggestRules` auf und schreibt das Ergebnis hier rein.
   */
  const [dedupeConfig, setDedupeConfig] = React.useState<DedupeConfig>(
    resume?.dedupeConfig ?? RUN_WIZARD_DEDUPE_DEFAULT,
  );

  /**
   * Steuert, welche Variante des Mapping-Steps angezeigt wird:
   *   - "placeholder"  → neuer einheitlicher Platzhalter-Mapper (Agent A's
   *                      `GET /api/runs/[id]/placeholders` Backend)
   *   - "legacy"       → alter 1:1-Mapping-Step als Fallback, falls der
   *                      Endpoint (noch) nicht verfügbar ist
   *   - "auto"         → Default; entscheidet die Step-Komponente selbst
   */
  const [mappingMode, setMappingMode] = React.useState<
    "auto" | "placeholder" | "legacy"
  >("auto");
  const [fallbackReason, setFallbackReason] = React.useState<string | null>(null);

  /** Create the draft run lazily when the user clicks "Weiter" from step 0. */
  async function ensureRunCreated(): Promise<string | null> {
    if (runId) return runId;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, name: runName.trim() || "Neue Runde" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Runde konnte nicht erstellt werden.");
        return null;
      }
      setRunId(json.run.id);
      return json.run.id as string;
    } finally {
      setCreating(false);
    }
  }

  /**
   * Ruft /api/google-sheets/tabs auf, um alle Untertabellen der URL zu holen.
   * Wenn ≥2 sichtbare Tabs mit Zeilen: Tab-Picker sichtbar machen.
   * Wenn nur 1: direkt zum normalen Upload weiter.
   *
   * Fallback: wenn der Tab-Endpoint fehlschlaegt (z.B. Sheets-API nicht
   * aktiviert oder Sheet nicht mit SA teilbar), gehen wir zum ALTEN
   * Verhalten zurueck: kein Tab-Picker, direkt upload-leads mit der
   * URL wie eingegeben. Das erlaubt Bestandskunden weiterhin zu arbeiten,
   * auch wenn Multi-Tab nicht verfuegbar ist.
   */
  async function discoverSheetTabsOrProceed(): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      const url = new URL("/api/google-sheets/tabs", window.location.origin);
      url.searchParams.set("url", sheetUrl.trim());
      const res = await fetch(url.toString());
      if (!res.ok) {
        // Silent-Fallback: alter Weg (Single-Tab) — kein Error setzen, damit
        // der User weiterarbeiten kann. Multi-Tab-Feature ist optional.
        console.warn("[wizard] tabs-endpoint failed, falling back to single-tab flow");
        setSelectedTabs([]);
        const ok = await uploadAndPreview();
        return ok;
      }
      const json = await res.json();
      const tabs = (json.tabs ?? []) as SheetTabInfo[];
      const eligible = tabs.filter((t) => t.rowCount > 0);
      if (eligible.length >= 2) {
        setSheetTabs(tabs);
        setSpreadsheetTitle(json.spreadsheetTitle ?? "");
        setTabPickerVisible(true);
        return true;
      }
      // Nur 1 relevanter Tab — direkt weiter, kein Picker nötig.
      setSelectedTabs(
        eligible.length === 1
          ? [{ gid: eligible[0].gid, title: eligible[0].title }]
          : [],
      );
      const ok = await uploadAndPreview();
      return ok;
    } catch (err) {
      // Netzwerk-Error → auch Fallback auf alten Weg statt zu blockieren.
      console.warn("[wizard] tabs-endpoint threw, falling back:", err);
      setSelectedTabs([]);
      const ok = await uploadAndPreview();
      return ok;
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadAndPreview(): Promise<boolean> {
    setError(null);
    const id = await ensureRunCreated();
    if (!id) return false;

    setSubmitting(true);
    try {
      const form = new FormData();
      if (uploadKind === "google") {
        form.set("kind", "google-sheets-url");
        // Wenn Tabs ausgewählt: Preview vom ersten Tab (Repräsentant).
        // Sonst: Original-URL, Backend nimmt Default-Tab.
        const previewGid =
          selectedTabs.length > 0 ? selectedTabs[0].gid : null;
        const previewUrl =
          previewGid !== null
            ? buildUrlWithGid(sheetUrl.trim(), previewGid)
            : sheetUrl.trim();
        form.set("url", previewUrl);
      } else {
        if (!file) {
          setError("Bitte eine Datei auswählen.");
          return false;
        }
        const lower = file.name.toLowerCase();
        const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xls");
        form.set("kind", isXlsx ? "xlsx" : "csv");
        form.set("file", file);
      }

      const res = await fetch(`/api/runs/${id}/upload-leads`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Upload fehlgeschlagen.");
        return false;
      }
      const p = json.preview as ParsedPreview;
      setPreview(p);

      // Auto-suggest mapping: match lowercased placeholders against headers.
      const headerLower = p.headers.map((h) => h.toLowerCase());
      const guess: Record<string, string> = {};
      for (const ph of STANDARD_PLACEHOLDERS) {
        const candidate = ph.key.toLowerCase();
        const idx = headerLower.findIndex(
          (h) =>
            h === candidate ||
            h === ph.label.toLowerCase() ||
            h.replace(/[\s_-]/g, "") === candidate ||
            (candidate === "firstname" && (h === "vorname" || h === "first")) ||
            (candidate === "lastname" && (h === "nachname" || h === "last")) ||
            (candidate === "website" && h.includes("web")) ||
            (candidate === "email" && (h.includes("mail") || h.includes("e-mail"))) ||
            (candidate === "company" && (h.includes("firma") || h.includes("company"))),
        );
        if (idx >= 0) guess[ph.key] = p.headers[idx];
      }
      setMapping(guess);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function saveMappingAndStart() {
    if (!runId) return;
    setSubmitting(true);
    setError(null);
    try {
      // Nur im Legacy-Mode hier mappen — der neue Platzhalter-Step speichert
      // sein Mapping bereits beim Verlassen, ein zweiter PUT würde den
      // gerade gesetzten `placeholderMapping`-Eintrag überschreiben.
      if (mappingMode === "legacy") {
        const mr = await fetch(`/api/runs/${runId}/mapping`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: mapping }),
        });
        if (!mr.ok) {
          const j = await mr.json().catch(() => ({}));
          setError(j?.error ?? "Mapping konnte nicht gespeichert werden.");
          return;
        }
      }

      // ── Multi-Tab-Bulk-Weg ──────────────────────────────────────────────
      // Wenn 2+ Tabs ausgewaehlt: erste (bereits geladene) Runde starten +
      // fuer tabs[1..N] ueber /api/runs/bulk zusaetzliche Runden erstellen +
      // dann jede sequentiell starten.
      if (bulkMode) {
        // 1) Erste Runde (Master) starten wie im Standard-Fall
        const sr = await fetch(`/api/runs/${runId}/start`, startRequestInit());
        const sj = await sr.json();
        if (!sr.ok) {
          setError(sj?.error ?? "Erste Runde konnte nicht gestartet werden.");
          return;
        }

        // 2) Zusaetzliche Runden fuer tabs[1..N] anlegen — inkl. des
        //    placeholderMapping des Master-Runs (Fallbacks + Wenn-Dann-Regeln),
        //    damit alle Bulk-Runden identisch generieren.
        let masterPlaceholderMapping: unknown = undefined;
        try {
          const runRes = await fetch(`/api/runs/${runId}`, {
            cache: "no-store",
          });
          if (runRes.ok) {
            const runJson = await runRes.json();
            masterPlaceholderMapping =
              runJson?.run?.columnMapping?.placeholderMapping ?? undefined;
          }
        } catch {
          // Best-effort — ohne placeholderMapping greift das legacy mapping.
        }

        const extraTabs = selectedTabs.slice(1);
        const bulkRes = await fetch("/api/runs/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId,
            source: { type: "google-sheets", url: sheetUrl.trim() },
            tabs: extraTabs.map((t) => ({
              runName: t.title,
              gid: t.gid,
              tabTitle: t.title,
            })),
            mapping,
            ...(masterPlaceholderMapping
              ? { placeholderMapping: masterPlaceholderMapping }
              : {}),
            dedupeConfig,
          }),
        });
        const bulkJson = await bulkRes.json();
        if (!bulkRes.ok) {
          setError(
            bulkJson?.error ??
              "Weitere Runden konnten nicht angelegt werden. Erste laeuft bereits.",
          );
          return;
        }

        // 3) Alle zusaetzlichen Runden sequentiell starten
        const extraIds = (bulkJson.runs ?? []).map((r: { id: string }) => r.id);
        for (const id of extraIds) {
          const r = await fetch(`/api/runs/${id}/start`, startRequestInit());
          if (!r.ok) {
            // Best-effort: continue, User sieht die Runde als draft und kann
            // manuell starten. Nicht abbrechen.
            console.warn(`[bulk] start ${id} failed`);
          }
        }

        // Redirect zur Kampagnen-Ansicht — dort sind alle N Runden sichtbar.
        router.push(`/kampagnen/${campaignId}`);
        return;
      }

      // ── Standard-Weg (1 Runde) ──────────────────────────────────────────
      const sr = await fetch(`/api/runs/${runId}/start`, startRequestInit());
      const sj = await sr.json();
      if (!sr.ok) {
        setError(sj?.error ?? "Runde konnte nicht gestartet werden.");
        return;
      }
      // Bei `webcam-only`-Kampagnen wird Phase 1 vom Backend übersprungen —
      // dann sofort zur Run-Detail (Phase 2 läuft direkt). Bei `with-
      // presentation` läuft Phase 1 im Hintergrund und wir landen auf der
      // Quality-Check-Review.
      if (sj?.preflightSkipped) {
        router.push(`/kampagnen/${campaignId}/runs/${runId}`);
      } else {
        router.push(`/kampagnen/${campaignId}/runs/${runId}/preflight`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Persistiert die aktuelle DedupeConfig in `runs.dedupe_config`. Wird beim
   * Wechsel Step 1 → Step 2 aufgerufen. Fehler werden tolerant geloggt — der
   * User soll wegen eines (vorübergehend) nicht erreichbaren Endpoints nicht
   * im Wizard hängen bleiben. Bei Bedarf greift im Start-Endpoint ein
   * Server-Side-Fallback auf die Default-Config zurück.
   */
  async function persistDedupeConfig() {
    if (!runId) return;
    try {
      const res = await fetch(`/api/runs/${runId}/dedupe-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dedupeConfig),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          "[wizard] dedupe-config PUT failed:",
          await res.text().catch(() => ""),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wizard] dedupe-config PUT errored:", err);
    }
  }

  async function handleNext() {
    if (step === 0) {
      // Bei Google-Sheets-URL: erst Tab-Enumeration, dann evtl. Picker.
      if (uploadKind === "google") {
        const ok = await discoverSheetTabsOrProceed();
        if (ok && !tabPickerVisible) {
          // discover hat den Preview schon geladen (nur 1 Tab-Fall)
          setStep(1);
        }
        return;
      }
      // File-Upload-Weg: Multi-Tab-Excel spaeter, aktuell einfach normal.
      const ok = await uploadAndPreview();
      if (ok) setStep(1);
      return;
    }
    if (step === 1) {
      await persistDedupeConfig();
      setStep(2);
      return;
    }
    if (step === 2) {
      // Nur Legacy-Mapping nutzt den globalen Weiter-Button — der neue
      // Placeholder-Step hat seinen eigenen (mit Validation).
      setStep(3);
      return;
    }
    if (step === 3) {
      await saveMappingAndStart();
    }
  }

  /**
   * Baut die Google-Sheets-URL mit spezifischem gid neu. Wenn die Ursprungs-URL
   * bereits einen gid enthaelt, wird er ersetzt.
   */
  function buildUrlWithGid(rawUrl: string, gid: number): string {
    try {
      const u = new URL(rawUrl);
      // gid kann in query oder in hash liegen. Wir setzen ihn im query.
      u.searchParams.set("gid", String(gid));
      // Alten gid in hash entfernen, sonst nimmt das Backend den ggf.
      u.hash = "";
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  /**
   * Nachdem der User Tabs im Multi-Tab-Picker gewaehlt hat: Preview vom
   * ersten Tab laden + step vorwaerts.
   */
  async function handleTabsSelected(chosen: SelectedTab[]) {
    if (chosen.length === 0) return;
    setSelectedTabs(chosen);
    setTabPickerVisible(false);
    const ok = await uploadAndPreview();
    if (ok) setStep(1);
  }

  return (
    <>
      <PageHeader
        title={resume ? "Runde fortsetzen" : "Neue Runde"}
        subtitle={`Kampagne ${campaignName} . Schritt ${step + 1} von ${STEPS.length}: ${STEPS[step]}`}
      />

      <ol className="mb-8 flex items-center gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((label, idx) => {
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <li key={label} className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium transition-all",
                  isActive && "bg-surface text-ink shadow-card",
                  isDone && !isActive && "text-ink-soft",
                  !isActive && !isDone && "text-ink-muted opacity-60",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    isActive
                      ? "bg-ink text-white"
                      : isDone
                        ? "bg-brand-soft text-brand-deep"
                        : "bg-canvas-deep text-ink-muted",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : idx + 1}
                </span>
                {label}
              </span>
              {idx < STEPS.length - 1 && <span className="h-px w-5 bg-line" />}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4 rounded-squircle-sm bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {step === 0 && tabPickerVisible && (
        <MultiTabPicker
          spreadsheetTitle={spreadsheetTitle}
          tabs={sheetTabs}
          loading={submitting}
          onCancel={() => {
            setTabPickerVisible(false);
            setSheetTabs([]);
            setSelectedTabs([]);
          }}
          onContinue={handleTabsSelected}
        />
      )}

      {step === 0 && !tabPickerVisible && (
        <Card>
          <CardHeader>
            <CardTitle>Adressliste hochladen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label htmlFor="run-name">Name der Runde</Label>
              <Input
                id="run-name"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="z. B. Quartalsausspielung"
              />
            </div>

            <div>
              <Label>Quelle</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUploadKind("file")}
                  className={cn(
                    "relative flex flex-col items-start gap-1 rounded-squircle-md p-4 text-left transition-all",
                    uploadKind === "file"
                      ? "ring-2 ring-brand bg-brand-soft/40"
                      : "bg-surface-soft hover:bg-surface-muted",
                  )}
                >
                  {uploadKind === "file" && (
                    <span className="absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" />
                    </span>
                  )}
                  <FileSpreadsheet className="size-5 text-brand-deep" />
                  <span className="text-sm font-semibold text-ink">XLSX / CSV</span>
                  <span className="text-xs text-ink-muted">Datei vom Rechner hochladen</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadKind("google")}
                  className={cn(
                    "relative flex flex-col items-start gap-1 rounded-squircle-md p-4 text-left transition-all",
                    uploadKind === "google"
                      ? "ring-2 ring-brand bg-brand-soft/40"
                      : "bg-surface-soft hover:bg-surface-muted",
                  )}
                >
                  {uploadKind === "google" && (
                    <span className="absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" />
                    </span>
                  )}
                  <Globe className="size-5 text-brand-deep" />
                  <span className="text-sm font-semibold text-ink">Google Sheets</span>
                  <span className="text-xs text-ink-muted">URL einfügen (öffentlich)</span>
                </button>
              </div>
            </div>

            {uploadKind === "file" ? (
              <div>
                <Label htmlFor="lead-file">Datei (XLSX oder CSV)</Label>
                <label
                  htmlFor="lead-file"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) setFile(dropped);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-squircle-md px-6 py-8 text-center transition-all",
                    dragOver
                      ? "bg-brand-soft/60 ring-2 ring-brand"
                      : file
                        ? "bg-brand-soft/40"
                        : "bg-surface-soft hover:bg-surface-muted",
                  )}
                >
                  {file ? (
                    <>
                      <span className="inline-flex size-10 items-center justify-center rounded-full bg-ok-soft">
                        <Check className="size-5 text-ok" />
                      </span>
                      <span className="text-sm font-semibold text-ink">{file.name}</span>
                      <span className="text-xs text-ink-muted">
                        {Math.round(file.size / 1024)} KB — klicken zum Ändern
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface shadow-card">
                        <Upload className="size-4 text-brand-deep" />
                      </span>
                      <span className="text-sm font-medium text-ink">
                        Datei hierher ziehen oder klicken
                      </span>
                      <span className="text-xs text-ink-muted">XLSX oder CSV</span>
                    </>
                  )}
                </label>
                <input
                  id="lead-file"
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="sheet-url">Google-Sheets-URL</Label>
                <UrlPicker
                  id="sheet-url"
                  value={sheetUrl}
                  onChange={setSheetUrl}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=0"
                  types={["gsheet"]}
                />
                <p className="text-xs text-ink-muted mt-2">
                  Freigabe: &quot;Jeder mit dem Link kann ansehen&quot; — aus der
                  Mediathek wählbar oder neue URL eintippen.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Adressliste</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {preview.totalRows} Zeile
                    {preview.totalRows === 1 ? "" : "n"} ·{" "}
                    {preview.headers.length} Spalten erkannt
                    {preview.truncated ? " (gekürzt auf 5000)" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewOpen((o) => !o)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted transition-colors"
                  aria-expanded={previewOpen}
                >
                  {previewOpen ? "Ausblenden" : "Anzeigen"}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      previewOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
              {previewOpen && (
                <div className="mt-3 overflow-x-auto rounded-squircle-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {preview.headers.map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((r, i) => (
                        <TableRow key={i}>
                          {preview.headers.map((h) => (
                            <TableCell key={h} className="text-xs text-ink-muted">
                              {r[h] ?? ""}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/*
            Duplikat-Erkennung (Paket C). Lebt zwischen Vorschau und
            Mapping, weil der User die Ergebnisse direkt nach dem Upload
            sehen will ("Ich habe X Leads, wovon Y Duplikate sind").
            Persistiert wird erst beim "Weiter"-Klick (sowohl im Legacy-
            als auch im Placeholder-Mapping-Pfad).
          */}
          <RunWizardDedupeCard
            rows={preview.rows}
            headers={preview.headers}
            value={dedupeConfig}
            onChange={setDedupeConfig}
          />
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-6">
          {/*
            Einheitlicher Platzhalter-Mapping-Step (Agent A's Backend).
            Wenn der GET-Endpoint einen Fehler liefert (z. B. weil das
            Backend noch nicht deployed ist), wechseln wir transparent auf
            den Legacy-1:1-Mapper unten.
          */}
          {mappingMode !== "legacy" && runId && (
            <RunWizardStepPlaceholders
              runId={runId}
              onContinue={() => {
                setStep(3);
              }}
              onFallbackRequested={(reason) => {
                setMappingMode("legacy");
                setFallbackReason(reason);
              }}
            />
          )}

          {mappingMode === "legacy" && (
            <Card>
              <CardHeader>
                <CardTitle>Spalten-Mapping</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {fallbackReason && (
                  <p className="text-xs text-warn">
                    Fallback aktiv: {fallbackReason}
                  </p>
                )}
                <p className="text-sm text-ink-muted">
                  Ordne unseren Platzhaltern die passenden Spalten aus deiner Liste zu.
                  Nicht zugewiesene Felder bleiben leer.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {STANDARD_PLACEHOLDERS.map((ph) => (
                    <div key={ph.key}>
                      <Label htmlFor={`map-${ph.key}`}>
                        {`{{`}
                        {ph.key}
                        {`}}`} . {ph.label}
                      </Label>
                      <Select
                        value={mapping[ph.key] ?? "__none__"}
                        onValueChange={(v) =>
                          setMapping((m) => {
                            const next = { ...m };
                            if (v === "__none__") delete next[ph.key];
                            else next[ph.key] = v;
                            return next;
                          })
                        }
                      >
                        <SelectTrigger id={`map-${ph.key}`}>
                          <SelectValue placeholder="Spalte wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— keine —</SelectItem>
                          {preview.headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {step === 3 && preview && (() => {
        // Lokales Preview der Dedupe-Auswirkung. Das endgültige Soft-Remove
        // läuft Server-side im Start-Endpoint — wir zeigen hier nur das, was
        // der User auch in Step 1 schon gesehen hat, damit es vor dem Klick
        // nicht "vergisst" wirkt.
        const dedupeWillRun =
          dedupeConfig.enabled &&
          dedupeConfig.rules.some((r) => r.enabled) &&
          preview.rows.length > 0;
        const dedupeStats = dedupeWillRun
          ? detectDuplicates(preview.rows, dedupeConfig).stats
          : null;
        // Effektive Lead-Zahl für die A/B-Vorschau. Bei Multi-Tab kennt der
        // Client nur die Zeilen-Summen — die exakte Zuteilung passiert
        // server-seitig pro Runde, hier zeigen wir nur die erste Runde.
        const abLeadCount = Math.max(
          0,
          preview.totalRows - (dedupeStats?.excluded ?? 0),
        );
        const abCountA = Math.round((abWeightA / 100) * abLeadCount);
        const bulkLeadTotal = sheetTabs
          .filter((t) => selectedTabs.some((s) => s.gid === t.gid))
          .reduce((sum, t) => sum + t.rowCount, 0);
        return (
          <div className="space-y-6">
          {abTestingActive && (
            <Card>
              <CardHeader>
                <CardTitle>A/B-Test — Verteilung der Briefe</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-ink-muted">
                  Diese Kampagne testet zwei Brief-Vorlagen. Vorbefüllt mit
                  der Standard-Verteilung der Kampagne — für diese Runde
                  frei anpassbar.
                </p>
                <AbSplitPicker
                  mode={abMode}
                  weightA={abWeightA}
                  onModeChange={setAbMode}
                  onWeightChange={setAbWeightA}
                  previewLine={
                    bulkMode ? (
                      <>
                        Die Regel gilt für alle {selectedTabs.length} Runden —
                        jede Runde wird einzeln nach{" "}
                        <strong>
                          {abWeightA}/{100 - abWeightA}
                        </strong>{" "}
                        aufgeteilt.
                      </>
                    ) : (
                      <>
                        <strong>{abCountA}</strong> Lead
                        {abCountA === 1 ? "" : "s"} → Brief A ·{" "}
                        <strong>{abLeadCount - abCountA}</strong> Lead
                        {abLeadCount - abCountA === 1 ? "" : "s"} → Brief B
                      </>
                    )
                  }
                />
              </CardContent>
            </Card>
          )}
          {/* Kassenbon — Credits im Fokus, Rest als Bon-Zeilen. */}
          <div className="mx-auto w-full max-w-md [filter:drop-shadow(0_14px_30px_rgba(60,50,110,0.16))]">
            <div className="rounded-t-squircle-md bg-surface px-6 pt-6 pb-5">
              <p className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-muted">
                VideoComet
              </p>
              <p className="mt-1.5 text-center text-sm font-semibold text-ink">
                {campaignName}
              </p>
              <p className="text-center text-xs text-ink-muted">
                {runName.trim() || "Neue Runde"} ·{" "}
                {new Date().toLocaleDateString("de-DE")}
              </p>

              <div className="my-4 border-t border-dashed border-line" />

              <div className="space-y-1.5 font-mono text-sm">
                {bulkMode ? (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-muted">
                        Runden (eine pro Tab)
                      </span>
                      <span className="font-semibold tabular-nums">
                        {selectedTabs.length}
                      </span>
                    </div>
                    {selectedTabs.map((t) => (
                      <div
                        key={t.gid}
                        className="flex items-baseline justify-between gap-3 text-xs text-ink-muted"
                      >
                        <span className="truncate">· {t.title}</span>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-muted">Leads gesamt</span>
                      <span className="font-semibold tabular-nums">
                        {bulkLeadTotal}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-muted">Leads in der Liste</span>
                      <span className="tabular-nums">{preview.totalRows}</span>
                    </div>
                    {dedupeStats && dedupeStats.excluded > 0 && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-ink-muted">
                          Duplikate entfernt
                        </span>
                        <span className="tabular-nums text-warn">
                          −{dedupeStats.excluded}
                        </span>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-muted">Zu startende Leads</span>
                      <span className="font-semibold tabular-nums">
                        {abLeadCount}
                      </span>
                    </div>
                  </>
                )}
                {pdfEnabled && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-muted">PDF-Brief</span>
                    <span>inklusive</span>
                  </div>
                )}
                {abTestingActive && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-muted">A/B-Split</span>
                    <span className="tabular-nums">
                      {abWeightA}/{100 - abWeightA} ·{" "}
                      {abMode === "sequential" ? "Reihe" : "Zufall"}
                    </span>
                  </div>
                )}
              </div>

              <div className="my-4 border-t border-dashed border-line" />

              <RunCostEstimate
                variant="receipt"
                leadCount={
                  // Bei Multi-Tab: Summe ueber alle Tabs (Estimate aus der
                  // Tab-Metadata). Dedup gilt pro Tab und wird nur fuer
                  // den ersten (Preview-)Tab exakt berechnet — fuer die
                  // anderen nutzen wir totalRows als konservativen Estimate.
                  bulkMode ? bulkLeadTotal : abLeadCount
                }
                onSufficient={setBillingReady}
              />

              {bulkMode && (
                <p className="mt-4 text-center text-[10px] leading-relaxed text-ink-muted">
                  Mapping und Duplikat-Regeln gelten identisch für alle Runden.
                </p>
              )}
            </div>
            {/* Zackenkante unten — Kassenbon-Abriss */}
            <div
              aria-hidden
              className="h-3 w-full bg-repeat-x [background-size:12px_12px] [background-image:linear-gradient(-45deg,transparent_6px,#ffffff_0),linear-gradient(45deg,transparent_6px,#ffffff_0)]"
            />
          </div>
          </div>
        );
      })()}

      {/* Footer-Nav ausblenden solange Tab-Picker sichtbar — er hat eigene Buttons. */}
      {tabPickerVisible ? null : (
      <div className="flex items-center justify-between mt-8">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting || creating}
          iconLeft={<ArrowLeft className="size-4" />}
        >
          Zurück
        </Button>
        {step < STEPS.length - 1 ? (
          // Im neuen Placeholder-Step rendert die Komponente ihren eigenen
          // „Weiter"-Button (mit Validation). Wir blenden den globalen Footer-
          // Button dann aus, damit die UX nicht doppelt wirkt.
          step === 2 && mappingMode !== "legacy" ? (
            <span />
          ) : (
            <Button
              onClick={handleNext}
              loading={submitting || creating}
              disabled={
                step === 0
                  ? uploadKind === "file"
                    ? !file
                    : !sheetUrl.trim()
                  : false
              }
              iconRight={<ArrowRight className="size-4" />}
            >
              {step === 0 ? "Datei einlesen" : "Weiter"}
            </Button>
          )
        ) : (
          <Button
            onClick={handleNext}
            loading={submitting}
            disabled={!billingReady}
            iconLeft={<Play className="size-4" />}
          >
            {bulkMode
              ? `${selectedTabs.length} Runden starten`
              : preview
                ? `${preview.totalRows} Leads starten`
                : "Starten"}
          </Button>
        )}
      </div>
      )}
    </>
  );
}
