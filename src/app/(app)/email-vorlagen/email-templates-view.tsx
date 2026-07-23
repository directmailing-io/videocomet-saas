"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface TemplateListItem {
  id: string;
  name: string;
  subject: string;
  isComplete: boolean;
  updatedAt: string;
}

export function EmailTemplatesView() {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<TemplateListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-templates", { cache: "no-store" });
      if (!res.ok) throw new Error("Load failed");
      const json = await res.json();
      setTemplates(json.templates ?? []);
    } catch (err) {
      toast({
        variant: "danger",
        title: "E-Mail-Vorlagen konnten nicht geladen werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Fehler");
      router.push(`/email-vorlagen/${json.template.id}`);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Vorlage konnte nicht angelegt werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreating(false);
      setCreateOpen(false);
      setNewName("");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Diese E-Mail-Vorlage löschen?")) return;
    try {
      const res = await fetch(`/api/email-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ variant: "success", title: "Vorlage gelöscht" });
      void load();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Fehler beim Löschen",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <>
      <PageHeader
        title="E-Mail-Vorlagen"
        subtitle="Vorlagen für den E-Mail-Versand über dein eigenes Postfach — mit Platzhaltern, Video-Vorschau und Pflicht-Impressum."
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            iconLeft={<Plus className="size-4" />}
          >
            Neue Vorlage
          </Button>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-ink-muted text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Lade …
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <AtSign className="size-10 mx-auto mb-3 text-ink-muted opacity-40" />
            <h3 className="font-semibold text-ink mb-1">
              Noch keine E-Mail-Vorlagen
            </h3>
            <p className="text-sm text-ink-muted mb-5 max-w-md mx-auto">
              Erstelle eine erste Vorlage mit Betreff, Text, Signatur und
              Impressum. Beim Versand wird sie pro Empfänger personalisiert
              und mit der Video-Vorschau kombiniert.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              iconLeft={<Plus className="size-4" />}
            >
              Erste Vorlage anlegen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((t) => (
            <Card key={t.id} hover>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/email-vorlagen/${t.id}`}
                      className="font-semibold text-ink hover:text-brand-deep truncate block"
                    >
                      {t.name}
                    </Link>
                    <p className="text-xs text-ink-muted truncate mt-0.5">
                      {t.subject.trim() ? t.subject : "Noch kein Betreff"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/email-vorlagen/${t.id}`}
                      className="text-ink-muted hover:text-brand-deep"
                      aria-label="Bearbeiten"
                      title="Bearbeiten"
                    >
                      <Pencil className="size-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      className="text-ink-muted hover:text-danger"
                      aria-label="Löschen"
                      title="Löschen"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  {t.isComplete ? (
                    <Badge variant="success" className="text-[10px]">
                      Einsatzbereit
                    </Badge>
                  ) : (
                    <Badge variant="warn" className="text-[10px]">
                      Unvollständig
                    </Badge>
                  )}
                  <span className="text-[11px] text-ink-muted">
                    {new Date(t.updatedAt).toLocaleDateString("de-DE")}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue E-Mail-Vorlage</DialogTitle>
            <DialogDescription>
              Gib der Vorlage einen Namen — Inhalt, Signatur und Impressum
              bearbeitest du im nächsten Schritt.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="new-template-name">Name</Label>
            <Input
              id="new-template-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z. B. Erstkontakt mit Video"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => void handleCreate()}
              loading={creating}
              disabled={!newName.trim()}
            >
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
