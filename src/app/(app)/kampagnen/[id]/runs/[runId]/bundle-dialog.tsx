"use client";

import * as React from "react";
import { Archive, FileDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface BundleDialogProps {
  runId: string;
  runName: string;
  abActive?: boolean;
}

const PDFS_PER_FILE = [10, 25, 50, 100, 200, 500];

type BundleVariant = "mixed" | "split" | "A" | "B";

/** Sentinel für „keine Sortierung" — kann nicht mit echten Spaltennamen kollidieren. */
const SORT_ORIGINAL = "__original__";

const VARIANT_OPTIONS: {
  value: BundleVariant;
  label: string;
  hint: string;
}[] = [
  {
    value: "mixed",
    label: "Original-Reihenfolge (gemischt)",
    hint: "A und B durcheinander, sortiert wie in der Tabelle.",
  },
  {
    value: "split",
    label: "Nach Variante getrennt",
    hint: "Ein Ordner pro Variante — Umschläge exakt in gleicher Reihenfolge.",
  },
  {
    value: "A",
    label: "Nur Brief A",
    hint: "Bundle enthält ausschließlich Leads mit Variante A.",
  },
  {
    value: "B",
    label: "Nur Brief B",
    hint: "Bundle enthält ausschließlich Leads mit Variante B.",
  },
];

export function BundleDialog({ runId, runName, abActive = false }: BundleDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pdfsPerFile, setPdfsPerFile] = React.useState("100");
  const [variant, setVariant] = React.useState<BundleVariant>("mixed");
  const [sortBy, setSortBy] = React.useState<string>(SORT_ORIGINAL);
  // Tatsächliche Spalten der Leadliste dieser Runde — jede Liste hat andere
  // Spalten, deshalb kommen die Optionen vom Server statt aus einer festen Liste.
  const [sortColumns, setSortColumns] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/runs/bundle-columns?runIds=${runId}`)
      .then((res) => (res.ok ? res.json() : { columns: [] }))
      .then((data: { columns?: string[] }) => {
        if (!cancelled) setSortColumns(data.columns ?? []);
      })
      .catch(() => {
        if (!cancelled) setSortColumns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, runId]);
  const [downloading, setDownloading] = React.useState(false);
  const { toast } = useToast();
  // Default base name: runName slugified light. User can overwrite.
  const defaultBase = React.useMemo(
    () =>
      runName
        .replace(/[äöüÄÖÜß]/g, (c) =>
          ({ ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" })[
            c
          ] ?? c,
        )
        .replace(/[^a-zA-Z0-9-_ ]+/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 60) || "videocomet",
    [runName],
  );
  const [baseName, setBaseName] = React.useState(defaultBase);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    // Sofortiges User-Feedback: der Server braucht bei vielen Leads
    // 3-15 Sekunden zum Bundeln — ohne Toast dachte der User das UI
    // haengt.
    toast({
      variant: "default",
      title: "Bundle wird vorbereitet ...",
      description:
        "Der Download startet automatisch, sobald die PDFs zusammengeführt sind. Kann bei vielen Leads einige Sekunden dauern.",
    });
    try {
      const params = new URLSearchParams({
        pdfsPerFile,
        baseName: baseName.trim() || defaultBase,
      });
      if (abActive && variant !== "mixed") params.set("variant", variant);
      if (sortBy !== SORT_ORIGINAL) params.set("sortBy", sortBy);
      // Bewusst kein window.location — der Fetch erlaubt uns den
      // Loading-State ehrlich zu tracken (bis die Server-Response Headers
      // kommen) und dann den Blob-Download programmatisch auszuloesen.
      const res = await fetch(`/api/runs/${runId}/pdf-bundle?${params}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename =
        (nameMatch && decodeURIComponent(nameMatch[1])) ??
        `${baseName.trim() || defaultBase}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        variant: "success",
        title: "Bundle heruntergeladen",
        description: filename,
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Bundle konnte nicht erstellt werden",
        description: err instanceof Error ? err.message : "Bitte erneut versuchen.",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="brand" iconLeft={<Archive className="size-4" />}>
          PDF-Bundle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PDF-Bundle herunterladen</DialogTitle>
          <DialogDescription>
            Alle fertigen PDFs werden in größere Multi-Seiten-PDFs
            zusammengeführt. Bei 1000 Leads + 100 pro Datei bekommst du am
            Ende 10 PDF-Dateien (Lead 1-100, 101-200, …) als ZIP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {abActive && (
            <div>
              <Label>Zusammenstellung (Split-Test)</Label>
              <div
                role="radiogroup"
                aria-label="Zusammenstellung"
                className="mt-1 space-y-1.5"
              >
                {VARIANT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={variant === opt.value}
                    onClick={() => setVariant(opt.value)}
                    className={`flex w-full items-start gap-2.5 rounded-squircle-sm px-3 py-2.5 text-left transition-colors ${
                      variant === opt.value
                        ? "bg-brand-soft/60 ring-2 ring-brand/30"
                        : "bg-surface-soft hover:bg-brand-soft/30"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1 size-3.5 shrink-0 rounded-full border-2 ${
                        variant === opt.value
                          ? "border-brand bg-brand"
                          : "border-line"
                      }`}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {opt.label}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {opt.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="bundle-sort">Sortierung</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger id="bundle-sort" disabled={sortColumns === null}>
                {sortColumns === null ? (
                  <span className="text-ink-muted">Spalten werden geladen …</span>
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SORT_ORIGINAL}>
                  Original-Reihenfolge (wie importiert)
                </SelectItem>
                {(sortColumns ?? []).map((col) => (
                  <SelectItem key={col} value={col}>
                    Nach „{col}&ldquo; (aufsteigend)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-ink-muted">
              Sortiert nach den Spalten deiner Leadliste. Umschläge werden
              automatisch in derselben Reihenfolge sortiert — Brief und
              Umschlag passen immer 1:1 zueinander.
            </p>
          </div>

          <div>
            <Label htmlFor="bundle-name">Dateiname</Label>
            <Input
              id="bundle-name"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              placeholder="z.B. Outreach-Mai-2026"
              maxLength={60}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Die einzelnen PDFs heißen <code>{baseName.trim() || defaultBase}_1-100.pdf</code>,{" "}
              <code>{baseName.trim() || defaultBase}_101-200.pdf</code>, …
            </p>
          </div>

          <div>
            <Label htmlFor="bundle-size">PDFs pro Datei</Label>
            <Select value={pdfsPerFile} onValueChange={setPdfsPerFile}>
              <SelectTrigger id="bundle-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PDFS_PER_FILE.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} Leads pro PDF
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={downloading}>Abbrechen</Button>
          </DialogClose>
          <Button
            onClick={handleDownload}
            iconLeft={<FileDown className="size-4" />}
            loading={downloading}
            disabled={downloading}
          >
            {downloading ? "Bundle wird erstellt ..." : "Bundle herunterladen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
