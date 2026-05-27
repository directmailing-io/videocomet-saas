"use client";

import * as React from "react";
import { Archive } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface BundleDialogProps {
  runId: string;
}

const SIZES = [25, 50, 100, 150, 200, 250, 500];

export function BundleDialog({ runId }: BundleDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [size, setSize] = React.useState("100");
  const [offset, setOffset] = React.useState("0");

  function handleDownload() {
    // Trigger browser download via navigation to a streaming endpoint.
    const url = `/api/runs/${runId}/pdf-bundle?size=${encodeURIComponent(size)}&offset=${encodeURIComponent(offset)}`;
    window.location.href = url;
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
            Wähle, wie viele PDFs in der ZIP-Datei zusammengefasst werden sollen.
            Mit dem Offset kannst du Folge-Pakete laden.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div>
            <Label htmlFor="bundle-size">PDFs pro ZIP</Label>
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger id="bundle-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bundle-offset">Start-Offset</Label>
            <Select value={offset} onValueChange={setOffset}>
              <SelectTrigger id="bundle-offset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 100, 250, 500, 1000, 2000].map((o) => (
                  <SelectItem key={o} value={String(o)}>
                    {o}
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
          <Button onClick={handleDownload} iconLeft={<Archive className="size-4" />}>
            ZIP herunterladen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
