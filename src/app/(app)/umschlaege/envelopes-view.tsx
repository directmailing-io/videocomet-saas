"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Plus, Loader2, Trash2, Copy, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface Template {
  id: string;
  name: string;
  format: "DIN_LANG" | "C4" | "C5" | "C6";
  updatedAt: string;
}

const FORMAT_LABEL: Record<Template["format"], string> = {
  DIN_LANG: "DIN lang (220 × 110 mm)",
  C4: "C4 (324 × 229 mm)",
  C5: "C5 (229 × 162 mm)",
  C6: "C6 (162 × 114 mm)",
};

export function EnvelopesView({ userId: _userId }: { userId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newFormat, setNewFormat] = React.useState<Template["format"]>("DIN_LANG");
  const [duplicatingId, setDuplicatingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/envelopes", { cache: "no-store" });
      if (!res.ok) throw new Error("Load failed");
      const json = await res.json();
      setTemplates(json.templates ?? []);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Umschläge konnten nicht geladen werden",
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
      const res = await fetch("/api/envelopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), format: newFormat }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Fehler");
      router.push(`/umschlaege/${json.template.id}`);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Umschlag konnte nicht angelegt werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreating(false);
      setCreateOpen(false);
      setNewName("");
    }
  }

  async function handleDuplicate(id: string) {
    setDuplicatingId(id);
    try {
      const res = await fetch(`/api/envelopes/${id}/duplicate`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Fehler");
      toast({ variant: "success", title: "Vorlage dupliziert" });
      router.push(`/umschlaege/${json.template.id}`);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Fehler beim Duplizieren",
        description: err instanceof Error ? err.message : undefined,
      });
      setDuplicatingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Diese Umschlag-Vorlage löschen?")) return;
    try {
      const res = await fetch(`/api/envelopes/${id}`, { method: "DELETE" });
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
        title="Umschlag-Vorlagen"
        subtitle="Erstelle wiederverwendbare Vorlagen für personalisierte Umschläge — auswählbar bei jeder neuen Runde."
        actions={
          <Button onClick={() => setCreateOpen(true)} iconLeft={<Plus className="size-4" />}>
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
            <Mail className="size-10 mx-auto mb-3 text-ink-muted opacity-40" />
            <h3 className="font-semibold text-ink mb-1">
              Noch keine Umschlag-Vorlagen
            </h3>
            <p className="text-sm text-ink-muted mb-5 max-w-md mx-auto">
              Erstelle eine erste Vorlage mit deinem Absender und dem
              Empfänger-Layout. Bei jeder Runde kannst du sie dann
              auswählen und personalisierte Umschläge dazu bekommen.
            </p>
            <Button onClick={() => setCreateOpen(true)} iconLeft={<Plus className="size-4" />}>
              Erste Vorlage anlegen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <Card key={t.id} className="hover:border-brand/40 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/umschlaege/${t.id}`}
                      className="font-semibold text-ink hover:text-brand-deep truncate block"
                    >
                      {t.name}
                    </Link>
                    <Badge variant="neutral" className="text-[10px] mt-1">
                      {FORMAT_LABEL[t.format]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/umschlaege/${t.id}`}
                      className="text-ink-muted hover:text-brand-deep"
                      aria-label="Bearbeiten"
                      title="Bearbeiten"
                    >
                      <Pencil className="size-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(t.id)}
                      disabled={duplicatingId !== null}
                      className="text-ink-muted hover:text-brand-deep disabled:opacity-50"
                      aria-label="Duplizieren"
                      title="Duplizieren"
                    >
                      {duplicatingId === t.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      className="text-ink-muted hover:text-red-600"
                      aria-label="Löschen"
                      title="Löschen"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-ink-muted">
                  Zuletzt geändert:{" "}
                  {new Date(t.updatedAt).toLocaleDateString("de-DE")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Umschlag-Vorlage</DialogTitle>
            <DialogDescription>
              Wähle Format und Name — Absender und Empfänger-Felder passt
              du danach im Editor an.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="env-name">Name der Vorlage</Label>
              <Input
                id="env-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z. B. Standard-Umschlag DIN lang"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="env-format">Format</Label>
              <Select
                value={newFormat}
                onValueChange={(v) => setNewFormat(v as Template["format"])}
              >
                <SelectTrigger id="env-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FORMAT_LABEL) as Template["format"][]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {FORMAT_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              loading={creating}
            >
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
