"use client";

import * as React from "react";
import { Archive, AlertTriangle, FileDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface BulkExportDialogRun {
  id: string;
  name: string;
  completedLeads?: number;
}

export interface BulkExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runIds: string[];
  runs: BulkExportDialogRun[];
  campaignName: string;
  /** Called once the download finishes successfully — used to clear the
   *  selection on the parent table. Optional. */
  onSuccess?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PDFS_PER_FILE_PRESETS = [100, 200, 250, 500] as const;
const PDFS_PER_FILE_MIN = 1;
const PDFS_PER_FILE_MAX = 1000;
const PDFS_PER_FILE_DEFAULT = 100;
const LOCAL_STORAGE_KEY = "vc:bulkExport:pdfsPerFile";
const LARGE_EXPORT_THRESHOLD = 2000;

type Stage = "configure" | "downloading" | "success";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampPdfsPerFile(n: number): number {
  if (!Number.isFinite(n)) return PDFS_PER_FILE_DEFAULT;
  return Math.min(PDFS_PER_FILE_MAX, Math.max(PDFS_PER_FILE_MIN, Math.round(n)));
}

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota / privacy-mode failures
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BulkExportDialog({
  open,
  onOpenChange,
  runIds,
  runs,
  campaignName: _campaignName,
  onSuccess,
}: BulkExportDialogProps) {
  const { toast } = useToast();

  const [stage, setStage] = React.useState<Stage>("configure");
  const [pdfsPerFile, setPdfsPerFile] = React.useState<number>(
    PDFS_PER_FILE_DEFAULT,
  );
  const [pdfsPerFileInput, setPdfsPerFileInput] = React.useState<string>(
    String(PDFS_PER_FILE_DEFAULT),
  );
  const [baseName, setBaseName] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const placeholder = React.useMemo(() => `bulk-export-${todayIso()}`, []);

  // Restore preferred bundle size from localStorage when the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    const stored = safeRead(LOCAL_STORAGE_KEY);
    if (stored !== null) {
      const parsed = clampPdfsPerFile(Number(stored));
      setPdfsPerFile(parsed);
      setPdfsPerFileInput(String(parsed));
    } else {
      setPdfsPerFile(PDFS_PER_FILE_DEFAULT);
      setPdfsPerFileInput(String(PDFS_PER_FILE_DEFAULT));
    }
    setStage("configure");
    setBaseName("");
    setError(null);
  }, [open]);

  // Persist preference whenever it changes via a preset/custom field.
  React.useEffect(() => {
    if (!open) return;
    safeWrite(LOCAL_STORAGE_KEY, String(pdfsPerFile));
  }, [open, pdfsPerFile]);

  // Derived figures used in the configure-screen summary.
  const selectedRuns = React.useMemo(
    () => runs.filter((r) => runIds.includes(r.id)),
    [runs, runIds],
  );
  const totalLeads = React.useMemo(
    () => selectedRuns.reduce((s, r) => s + (r.completedLeads ?? 0), 0),
    [selectedRuns],
  );
  const estimatedBundles = React.useMemo(() => {
    if (pdfsPerFile <= 0) return 0;
    return selectedRuns.reduce(
      (s, r) => s + Math.ceil((r.completedLeads ?? 0) / pdfsPerFile),
      0,
    );
  }, [selectedRuns, pdfsPerFile]);

  const isLargeExport = totalLeads > LARGE_EXPORT_THRESHOLD;

  function applyPreset(value: number) {
    const clamped = clampPdfsPerFile(value);
    setPdfsPerFile(clamped);
    setPdfsPerFileInput(String(clamped));
  }

  function handleCustomInput(raw: string) {
    setPdfsPerFileInput(raw);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= PDFS_PER_FILE_MIN) {
      setPdfsPerFile(clampPdfsPerFile(parsed));
    }
  }

  async function handleSubmit() {
    if (runIds.length === 0) return;
    setError(null);
    setStage("downloading");

    const trimmedBase = baseName.trim();
    const finalBaseForDownload = trimmedBase || placeholder;

    try {
      const res = await fetch("/api/runs/bulk-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runIds,
          pdfsPerFile,
          // Only send baseName when the user typed something — let the
          // backend pick its own default otherwise.
          ...(trimmedBase ? { baseName: trimmedBase } : {}),
        }),
      });

      if (!res.ok) {
        let message = `Export fehlgeschlagen (HTTP ${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Not JSON — keep the default message.
        }
        setError(message);
        setStage("configure");
        toast({
          title: "Export fehlgeschlagen",
          description: message,
          variant: "danger",
        });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${finalBaseForDownload}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Schedule revocation so the browser has actually started saving.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      setStage("success");
      toast({
        title: "Export abgeschlossen",
        description: `${finalBaseForDownload}.zip wurde heruntergeladen.`,
        variant: "success",
      });

      // Close the dialog and reset selection after a short delay.
      window.setTimeout(() => {
        onSuccess?.();
        onOpenChange(false);
      }, 2000);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Verbindung zum Server fehlgeschlagen.";
      setError(message);
      setStage("configure");
      toast({
        title: "Export fehlgeschlagen",
        description: message,
        variant: "danger",
      });
    }
  }

  const lockOpen = stage === "downloading" || stage === "success";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Prevent closing the dialog while a download is in flight.
        if (!next && lockOpen) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" showClose={!lockOpen}>
        {stage === "configure" && (
          <ConfigureView
            runs={selectedRuns}
            runIds={runIds}
            totalLeads={totalLeads}
            estimatedBundles={estimatedBundles}
            isLargeExport={isLargeExport}
            pdfsPerFile={pdfsPerFile}
            pdfsPerFileInput={pdfsPerFileInput}
            onApplyPreset={applyPreset}
            onCustomInput={handleCustomInput}
            baseName={baseName}
            onBaseName={setBaseName}
            placeholder={placeholder}
            error={error}
            onCancel={() => onOpenChange(false)}
            onSubmit={() => void handleSubmit()}
          />
        )}

        {stage === "downloading" && (
          <DownloadingView totalLeads={totalLeads} />
        )}

        {stage === "success" && (
          <SuccessView onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-views                                                          */
/* ------------------------------------------------------------------ */

interface ConfigureViewProps {
  runs: BulkExportDialogRun[];
  runIds: string[];
  totalLeads: number;
  estimatedBundles: number;
  isLargeExport: boolean;
  pdfsPerFile: number;
  pdfsPerFileInput: string;
  onApplyPreset: (n: number) => void;
  onCustomInput: (raw: string) => void;
  baseName: string;
  onBaseName: (v: string) => void;
  placeholder: string;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function ConfigureView({
  runs,
  runIds,
  totalLeads,
  estimatedBundles,
  isLargeExport,
  pdfsPerFile,
  pdfsPerFileInput,
  onApplyPreset,
  onCustomInput,
  baseName,
  onBaseName,
  placeholder,
  error,
  onCancel,
  onSubmit,
}: ConfigureViewProps) {
  const canSubmit =
    runIds.length > 0 &&
    pdfsPerFile >= PDFS_PER_FILE_MIN &&
    pdfsPerFile <= PDFS_PER_FILE_MAX;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Bulk-Export · {runIds.length}{" "}
          {runIds.length === 1 ? "Runde" : "Runden"}
        </DialogTitle>
        <DialogDescription>
          Insgesamt {totalLeads.toLocaleString("de-DE")} fertige Leads — werden
          als ZIP mit PDFs und Adressliste heruntergeladen.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-1">
        {/* Selected runs preview ------------------------------------ */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
            Ausgewählte Runden
          </p>
          <ul
            className={cn(
              "rounded-squircle-md bg-surface-soft px-3 py-2 text-sm",
              runs.length > 6 ? "max-h-44 overflow-y-auto" : "",
            )}
          >
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-3 py-1"
              >
                <span className="truncate text-ink">{r.name}</span>
                <span className="shrink-0 tabular-nums text-xs text-ink-muted">
                  {(r.completedLeads ?? 0).toLocaleString("de-DE")} Leads
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Bundle size --------------------------------------------- */}
        <section>
          <Label htmlFor="bulk-export-custom-size">Bündel-Größe</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PDFS_PER_FILE_PRESETS.map((preset) => {
              const active = pdfsPerFile === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  aria-pressed={active}
                  className={cn(
                    "h-9 rounded-full px-4 text-sm font-semibold transition-colors",
                    active
                      ? "bg-brand text-white"
                      : "bg-surface-soft text-ink hover:bg-canvas-deep",
                  )}
                >
                  {preset}
                </button>
              );
            })}
            <div className="flex items-center gap-2 ml-auto">
              <Label
                htmlFor="bulk-export-custom-size"
                className="mb-0 normal-case tracking-normal text-xs text-ink-muted"
              >
                eigene Größe
              </Label>
              <Input
                id="bulk-export-custom-size"
                type="number"
                min={PDFS_PER_FILE_MIN}
                max={PDFS_PER_FILE_MAX}
                value={pdfsPerFileInput}
                onChange={(e) => onCustomInput(e.target.value)}
                className="w-24 py-2"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Ergibt ca.{" "}
            <span className="font-semibold text-ink">
              {estimatedBundles.toLocaleString("de-DE")}
            </span>{" "}
            PDFs ({pdfsPerFile} Leads pro Bündel).
          </p>
        </section>

        {/* File name ----------------------------------------------- */}
        <section>
          <Label htmlFor="bulk-export-basename">Dateiname (optional)</Label>
          <Input
            id="bulk-export-basename"
            value={baseName}
            onChange={(e) => onBaseName(e.target.value)}
            placeholder={placeholder}
            maxLength={80}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Wird der Name leer gelassen, vergibt der Server automatisch{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[11px]">
              {placeholder}.zip
            </code>
            .
          </p>
        </section>

        {/* Big-export warning -------------------------------------- */}
        {isLargeExport && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-squircle-md border border-warn/30 bg-warn/5 px-4 py-3"
          >
            <AlertTriangle className="size-5 text-warn shrink-0 mt-0.5" />
            <div className="text-sm text-ink">
              <p className="font-semibold">Großer Export</p>
              <p className="text-ink-muted">
                Mehr als 2.000 Leads — die ZIP-Datei kann mehrere GB groß
                werden und wird komplett in deinem Browser gepuffert. Lass
                den Tab geöffnet, bis der Download startet.
              </p>
            </div>
          </div>
        )}

        {/* Inline error -------------------------------------------- */}
        {error && (
          <p
            role="alert"
            className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-squircle-md px-3 py-2"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          iconLeft={<FileDown className="size-4" />}
        >
          Export starten
        </Button>
      </DialogFooter>
    </>
  );
}

function DownloadingView({ totalLeads }: { totalLeads: number }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Export wird erstellt …</DialogTitle>
        <DialogDescription>
          {totalLeads.toLocaleString("de-DE")} Leads werden zu PDFs gebündelt
          und mit der Adressliste in einer ZIP-Datei zusammengepackt. Das kann
          einige Minuten dauern (mehrere GB möglich). Bitte den Tab geöffnet
          lassen.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <Loader2 className="size-10 text-brand animate-spin" />
        <p className="text-sm font-medium text-ink">
          Server erzeugt PDFs und Adressliste …
        </p>
        <p className="text-xs text-ink-muted">
          Sobald der Download startet, kannst du diesen Dialog schließen.
        </p>
      </div>

      <DialogFooter>
        <Button variant="ghost" type="button" disabled>
          Abbrechen
        </Button>
        <Button type="button" disabled iconLeft={<Archive className="size-4" />}>
          Wird erstellt …
        </Button>
      </DialogFooter>
    </>
  );
}

function SuccessView({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Export abgeschlossen</DialogTitle>
        <DialogDescription>
          Der Download wurde gestartet. Du kannst diesen Dialog schließen.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center justify-center gap-3 py-6">
        <div className="size-14 rounded-full bg-ok/10 flex items-center justify-center">
          <FileDown className="size-7 text-ok" />
        </div>
        <p className="text-sm font-medium text-ink">
          ZIP-Datei wird gespeichert.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Schließen
        </Button>
      </DialogFooter>
    </>
  );
}
