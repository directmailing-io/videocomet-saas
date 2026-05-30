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
}

const PDFS_PER_FILE = [10, 25, 50, 100, 200, 500];

export function BundleDialog({ runId, runName }: BundleDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pdfsPerFile, setPdfsPerFile] = React.useState("100");
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

  function handleDownload() {
    const params = new URLSearchParams({
      pdfsPerFile,
      baseName: baseName.trim() || defaultBase,
    });
    window.location.href = `/api/runs/${runId}/pdf-bundle?${params}`;
    setOpen(false);
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
            <Button variant="ghost">Abbrechen</Button>
          </DialogClose>
          <Button
            onClick={handleDownload}
            iconLeft={<FileDown className="size-4" />}
          >
            Bundle herunterladen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
