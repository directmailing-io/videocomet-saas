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

  const [uploadKind, setUploadKind] = React.useState<"file" | "google">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ParsedPreview | null>(null);

  const [mapping, setMapping] = React.useState<Record<string, string>>({});

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

  async function uploadAndPreview(): Promise<boolean> {
    setError(null);
    const id = await ensureRunCreated();
    if (!id) return false;

    setSubmitting(true);
    try {
      const form = new FormData();
      if (uploadKind === "google") {
        form.set("kind", "google-sheets-url");
        form.set("url", sheetUrl.trim());
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
      const sr = await fetch(`/api/runs/${runId}/start`, { method: "POST" });
      const sj = await sr.json();
      if (!sr.ok) {
        setError(sj?.error ?? "Runde konnte nicht gestartet werden.");
        return;
      }
      // Direkt zur Pre-Flight-Review — Phase 1 (URL-Probe + Screenshot)
      // läuft im Hintergrund, der User soll seine Ankunft auf der Review-
      // Seite verbringen statt auf der Run-Detail-Seite (die ohnehin nur
      // zur Preflight-Seite redirected solange `awaiting_approval`).
      router.push(`/kampagnen/${campaignId}/runs/${runId}/preflight`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (step === 0) {
      const ok = await uploadAndPreview();
      if (ok) setStep(1);
      return;
    }
    if (step === 1) {
      // Validate: at least firstName/lastName/website is mapped (optional v1)
      setStep(2);
      return;
    }
    if (step === 2) {
      await saveMappingAndStart();
    }
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

      {step === 0 && (
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
                <Input
                  id="sheet-url"
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=0"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                />
                <p className="text-xs text-ink-muted mt-2">
                  Hinweis: Die Datei muss in der Freigabe auf &quot;Jeder mit Link&quot; stehen.
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

          <Card>
            <CardHeader>
              <CardTitle>Spalten-Mapping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
        </div>
      )}

      {step === 2 && preview && (
        <Card>
          <CardHeader>
            <CardTitle>Zusammenfassung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink-muted">
              Du startest <strong className="text-ink">{preview.totalRows}</strong>{" "}
              Lead{preview.totalRows === 1 ? "" : "s"} für die Kampagne{" "}
              <strong className="text-ink">{campaignName}</strong>.
            </p>
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
          </CardContent>
        </Card>
      )}

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
        ) : (
          <Button
            onClick={handleNext}
            loading={submitting}
            iconLeft={<Play className="size-4" />}
          >
            {preview ? `${preview.totalRows} Leads starten` : "Starten"}
          </Button>
        )}
      </div>

      {/* Hidden upload icon to ensure tree-shaking keeps the lucide-react peer */}
      <span aria-hidden className="hidden">
        <Upload className="size-0" />
      </span>
    </>
  );
}
