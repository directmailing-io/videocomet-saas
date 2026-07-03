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
import { Badge } from "@/components/ui/badge";
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

export interface RunWizardProps {
  campaignId: string;
  campaignName: string;
  pdfEnabled: boolean;
}

interface ParsedPreview {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  truncated?: boolean;
}

const STEPS = ["Adressliste", "Vorschau & Mapping", "Starten"];

// Standard placeholders we always offer; campaigns may bring more via the
// google-docs placeholders, but for v1 we use this baseline.
const STANDARD_PLACEHOLDERS = [
  { key: "firstName", label: "Vorname" },
  { key: "lastName", label: "Nachname" },
  { key: "company", label: "Firma" },
  { key: "website", label: "Website" },
  { key: "email", label: "E-Mail" },
];

export function RunWizard({ campaignId, campaignName, pdfEnabled }: RunWizardProps) {
  const router = useRouter();

  const [step, setStep] = React.useState(0);
  const [runName, setRunName] = React.useState(
    `Runde ${new Date().toLocaleDateString("de-DE")}`,
  );
  const [runId, setRunId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Billing-Gate: der Estimate-Component setzt das je nach Balance +
  // Subscription-Status. Wenn false, disable'n wir den Start-Button.
  const [billingReady, setBillingReady] = React.useState(true);

  const [uploadKind, setUploadKind] = React.useState<"file" | "google">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ParsedPreview | null>(null);

  // ── Multi-Tab-State (nur für Google Sheets mit mehreren Untertabellen) ──
  // Wenn der User eine URL zu einem Multi-Tab-Sheet paste, zeigen wir einen
  // Tab-Picker VOR Step 1. Er wählt welche Tabs verarbeitet werden — für
  // jede Auswahl wird beim Submit eine eigene Runde gespawned.
  const [tabPickerVisible, setTabPickerVisible] = React.useState(false);
  const [sheetTabs, setSheetTabs] = React.useState<SheetTabInfo[]>([]);
  const [spreadsheetTitle, setSpreadsheetTitle] = React.useState<string>("");
  const [selectedTabs, setSelectedTabs] = React.useState<SelectedTab[]>([]);
  const bulkMode = selectedTabs.length > 1;

  const [mapping, setMapping] = React.useState<Record<string, string>>({});

  /**
   * Dedupe-Config für die Card "Duplikate erkennen". Default: enabled mit
   * `keep-first`-Strategie und LEEREN Regeln — die Card ruft beim ersten
   * Mount selbst `suggestRules` auf und schreibt das Ergebnis hier rein.
   */
  const [dedupeConfig, setDedupeConfig] = React.useState<DedupeConfig>(
    RUN_WIZARD_DEDUPE_DEFAULT,
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
   */
  async function discoverSheetTabsOrProceed(): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      const url = new URL("/api/google-sheets/tabs", window.location.origin);
      url.searchParams.set("url", sheetUrl.trim());
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Tabs konnten nicht geladen werden.");
        return false;
      }
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
      setError(err instanceof Error ? err.message : "Tabs-Fetch fehlgeschlagen.");
      return false;
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
        const sr = await fetch(`/api/runs/${runId}/start`, { method: "POST" });
        const sj = await sr.json();
        if (!sr.ok) {
          setError(sj?.error ?? "Erste Runde konnte nicht gestartet werden.");
          return;
        }

        // 2) Zusaetzliche Runden fuer tabs[1..N] anlegen
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
          const r = await fetch(`/api/runs/${id}/start`, { method: "POST" });
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
      const sr = await fetch(`/api/runs/${runId}/start`, { method: "POST" });
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
      // Validate: at least firstName/lastName/website is mapped (optional v1)
      await persistDedupeConfig();
      setStep(2);
      return;
    }
    if (step === 2) {
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
        title="Neue Runde"
        subtitle={`Kampagne ${campaignName} . Schritt ${step + 1} von ${STEPS.length}: ${STEPS[step]}`}
      />

      <ol className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((label, idx) => {
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <li key={label} className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold border transition-colors",
                  isActive && "bg-brand text-white border-brand",
                  isDone && "bg-brand-soft text-brand-deep border-brand-soft",
                  !isActive && !isDone && "bg-surface text-ink-muted border-line",
                )}
              >
                {isDone ? <Check className="size-3.5" /> : idx + 1}
              </span>
              <span className={cn("text-xs font-medium", isActive ? "text-ink" : "text-ink-muted")}>
                {label}
              </span>
              {idx < STEPS.length - 1 && <span className="w-6 h-px bg-line ml-1" />}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4 rounded-squircle-sm border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
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
                    "flex flex-col items-start gap-1 rounded-squircle-md border p-4 text-left transition-colors",
                    uploadKind === "file"
                      ? "border-brand bg-brand-soft"
                      : "border-line hover:border-line",
                  )}
                >
                  <FileSpreadsheet className="size-5 text-brand-deep" />
                  <span className="text-sm font-semibold text-ink">XLSX / CSV</span>
                  <span className="text-xs text-ink-muted">Datei vom Rechner hochladen</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadKind("google")}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-squircle-md border p-4 text-left transition-colors",
                    uploadKind === "google"
                      ? "border-brand bg-brand-soft"
                      : "border-line hover:border-line",
                  )}
                >
                  <Globe className="size-5 text-brand-deep" />
                  <span className="text-sm font-semibold text-ink">Google Sheets</span>
                  <span className="text-xs text-ink-muted">URL einfügen (öffentlich)</span>
                </button>
              </div>
            </div>

            {uploadKind === "file" ? (
              <div>
                <Label htmlFor="lead-file">Datei (XLSX oder CSV)</Label>
                <input
                  id="lead-file"
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-deep"
                />
                {file && (
                  <p className="text-xs text-ink-muted mt-2">
                    {file.name} . {Math.round(file.size / 1024)} KB
                  </p>
                )}
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
                  Hinweis: Die Datei muss in der Freigabe auf &quot;Jeder mit Link&quot; stehen.
                  Aus der Mediathek wählbar oder als neue URL eintippen.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Vorschau</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-muted mb-3">
                {preview.totalRows} Zeile{preview.totalRows === 1 ? "" : "n"} erkannt
                {preview.truncated ? " (gekuerzt auf 5000)" : ""}.
              </p>
              <div className="overflow-x-auto rounded-squircle-md border border-line">
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

          {/*
            Neuer einheitlicher Platzhalter-Mapping-Step (Agent A's Backend).
            Wenn der GET-Endpoint einen Fehler liefert (z. B. weil das
            Backend noch nicht deployed ist), wechseln wir transparent auf
            den Legacy-1:1-Mapper unten.
          */}
          {mappingMode !== "legacy" && runId && (
            <RunWizardStepPlaceholders
              runId={runId}
              previewRows={preview.rows}
              onContinue={async () => {
                await persistDedupeConfig();
                setStep(2);
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

      {step === 2 && preview && (() => {
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
        return (
          <Card>
            <CardHeader>
              <CardTitle>Zusammenfassung</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {bulkMode ? (
                <div className="rounded-squircle-sm bg-brand-soft/40 border border-brand-soft px-3 py-3 space-y-2">
                  <p className="text-sm text-ink">
                    Du startest{" "}
                    <strong>{selectedTabs.length} Runden</strong> für die
                    Kampagne{" "}
                    <strong className="text-ink">{campaignName}</strong> —
                    eine pro Tab.
                  </p>
                  <ul className="text-xs text-ink-muted space-y-1">
                    {selectedTabs.map((t, i) => (
                      <li key={t.gid} className="flex items-center gap-2">
                        <span className="inline-flex size-4 items-center justify-center rounded bg-brand text-white text-[10px] font-bold">
                          {i + 1}
                        </span>
                        <span className="font-medium">{t.title}</span>
                        {i === 0 && (
                          <span className="text-[10px] uppercase tracking-wider text-brand-deep">
                            Vorschau oben
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-ink-muted pt-1 border-t border-brand-soft">
                    Mapping und Duplikat-Regeln gelten identisch für alle
                    Runden. Für Tab 1 zeigen wir dir eine Vorschau — die
                    anderen Tabs müssen dieselben Spalten haben.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">
                  Du startest{" "}
                  <strong className="text-ink">{preview.totalRows}</strong>{" "}
                  Lead{preview.totalRows === 1 ? "" : "s"} für die Kampagne{" "}
                  <strong className="text-ink">{campaignName}</strong>.
                </p>
              )}
              {dedupeStats && dedupeStats.excluded > 0 && (
                <p className="text-sm text-warn">
                  <strong>{dedupeStats.excluded}</strong> Duplikat
                  {dedupeStats.excluded === 1 ? "" : "e"} werden vor dem Start
                  entfernt.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {Object.entries(mapping).map(([k, v]) => (
                  <Badge key={k} variant="brand">
                    {k} -&gt; {v}
                  </Badge>
                ))}
                {Object.keys(mapping).length === 0 && (
                  <Badge variant="warn">Kein Mapping gesetzt</Badge>
                )}
                {pdfEnabled && <Badge variant="success">PDF-Brief aktiv</Badge>}
              </div>
              <RunCostEstimate
                leadCount={
                  // Bei Multi-Tab: Summe ueber alle Tabs (Estimate aus der
                  // Tab-Metadata). Dedup gilt pro Tab und wird nur fuer
                  // den ersten (Preview-)Tab exakt berechnet — fuer die
                  // anderen nutzen wir totalRows als konservativen Estimate.
                  bulkMode
                    ? sheetTabs
                        .filter((t) => selectedTabs.some((s) => s.gid === t.gid))
                        .reduce((sum, t) => sum + t.rowCount, 0)
                    : Math.max(
                        0,
                        preview.totalRows - (dedupeStats?.excluded ?? 0),
                      )
                }
                onSufficient={setBillingReady}
              />
            </CardContent>
          </Card>
        );
      })()}

      {/* Footer-Nav ausblenden solange Tab-Picker sichtbar — er hat eigene Buttons. */}
      {tabPickerVisible ? null : (
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-line">
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
          step === 1 && mappingMode !== "legacy" ? (
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

      {/* Hidden upload icon to ensure tree-shaking keeps the lucide-react peer */}
      <span aria-hidden className="hidden">
        <Upload className="size-0" />
      </span>
    </>
  );
}
