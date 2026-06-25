"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";

interface Props {
  trigger?: React.ReactNode;
}

export function UrlAddDialog({ trigger }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setUrl("");
    setTitle("");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast({ variant: "danger", title: "URL fehlt" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/media-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          title: title.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        item?: { id: string };
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({
        variant: "success",
        title: "Link gespeichert",
        description: "Vorschau wird im Hintergrund erstellt.",
      });
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Speichern fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="brand">
            <Link2 className="size-4 mr-2" />
            Neuer Link
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link zur Mediathek hinzufügen</DialogTitle>
          <DialogDescription>
            Speichere Google Docs, Sheets oder beliebige Links. Eine Vorschau wird
            automatisch erzeugt — du kannst sie später aktualisieren.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="url-add-url" className="text-sm font-medium">
              URL
            </label>
            <Input
              id="url-add-url"
              type="url"
              placeholder="https://docs.google.com/document/d/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="url-add-title" className="text-sm font-medium">
              Titel <span className="text-ink-muted text-xs">(optional)</span>
            </label>
            <Input
              id="url-add-title"
              type="text"
              placeholder="Wird aus URL erkannt wenn leer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Abbrechen
            </Button>
            <Button type="submit" variant="brand" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : null}
              Speichern
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
