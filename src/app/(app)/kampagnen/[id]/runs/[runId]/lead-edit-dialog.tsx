"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";

interface LeadLike {
  id: string;
  status: string;
  data: Record<string, string>;
}

/**
 * Dialog zum Editieren der Lead-Daten (JSONB `data`).
 * Zeigt alle vorhandenen Keys als Input-Felder — der User kann
 * einzelne Werte korrigieren und speichern. Nach dem Save kann er
 * direkt ein Re-Generate anstoßen (optional, per Button).
 */
export function LeadEditDialog({
  lead,
  onOpenChange,
  onSaved,
}: {
  lead: LeadLike | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: { id: string; data: Record<string, string> }) => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [regenAfter, setRegenAfter] =
    React.useState<null | "all" | "pdf" | "envelope">(null);

  React.useEffect(() => {
    if (lead) {
      setValues({ ...lead.data });
      setRegenAfter(null);
    }
  }, [lead]);

  if (!lead) return null;

  // Case-insensitive Sortierung, damit "Anrede" / "ANREDE" oder "city" / "City"
  // in der Tabelle direkt nebeneinander stehen — der User erkennt Duplikate
  // aus der CSV sofort und weiss welche Zeile er editieren soll.
  const keys = Object.keys(values).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

  // Markiere Keys, die einen case-insensitive Twin haben — dann bekommt die
  // Zeile ein dezentes "aus CSV doppelt" Hinweis.
  const lowerCounts = new Map<string, number>();
  for (const k of keys) {
    const kk = k.toLowerCase();
    lowerCounts.set(kk, (lowerCounts.get(kk) ?? 0) + 1);
  }
  const dupSet = new Set(
    keys.filter((k) => (lowerCounts.get(k.toLowerCase()) ?? 0) > 1),
  );

  async function handleSave() {
    if (!lead) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: values }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Fehler");
      onSaved({ id: lead.id, data: values });
      toast({ variant: "success", title: "Lead gespeichert" });

      if (regenAfter) {
        const rr = await fetch(`/api/leads/${lead.id}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: regenAfter }),
        });
        const rrj = await rr.json().catch(() => ({}));
        if (!rr.ok) throw new Error(rrj?.error ?? "Regenerieren fehlgeschlagen");
        toast({
          variant: "success",
          title:
            regenAfter === "all"
              ? "Lead wird neu generiert …"
              : regenAfter === "pdf"
                ? "PDF wird neu generiert …"
                : "Umschlag wird neu generiert …",
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Speichern fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Lead-Daten bearbeiten</DialogTitle>
          <DialogDescription>
            Alle Felder aus deiner CSV — korrigiere einzelne Werte und wähle
            optional aus, was direkt danach neu generiert werden soll.
            {dupSet.size > 0 && (
              <span className="block mt-1 text-amber-700">
                Hinweis: {dupSet.size / 2} Feld
                {dupSet.size / 2 === 1 ? "" : "er"} kommen in deiner CSV
                mehrfach mit verschiedener Schreibweise vor (mit „dup"
                markiert). Bearbeite ggf. beide, damit alle Platzhalter
                aktualisiert werden.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-squircle-md bg-surface-soft divide-y divide-line-soft">
          {keys.length === 0 ? (
            <p className="text-sm text-ink-muted p-4">Keine Daten vorhanden.</p>
          ) : (
            keys.map((k) => (
              <div
                key={k}
                className="grid grid-cols-[220px_1fr] items-center gap-3 px-3 py-2 hover:bg-line-soft/40"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Label
                    htmlFor={`lead-${k}`}
                    className="text-xs font-medium text-ink-muted truncate"
                    title={k}
                  >
                    {k}
                  </Label>
                  {dupSet.has(k) && (
                    <span
                      className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 text-[9px] uppercase tracking-wide px-1.5 py-0.5 shrink-0"
                      title="Diese Spalte kommt in deiner CSV mehrfach mit unterschiedlicher Schreibweise vor."
                    >
                      dup
                    </span>
                  )}
                </div>
                <Input
                  id={`lead-${k}`}
                  value={values[k] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  className="h-8 text-sm"
                />
              </div>
            ))
          )}
        </div>

        <div className="border-t border-line-soft pt-4 space-y-2">
          <Label className="text-xs">Nach dem Speichern automatisch neu generieren</Label>
          <div className="grid grid-cols-4 gap-1">
            {([
              { key: null, label: "Nur speichern" },
              { key: "pdf", label: "+ PDF neu" },
              { key: "envelope", label: "+ Umschlag" },
              { key: "all", label: "+ Alles neu" },
            ] as Array<{ key: null | "pdf" | "envelope" | "all"; label: string }>).map((o) => (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => setRegenAfter(o.key)}
                className={
                  regenAfter === o.key
                    ? "h-9 rounded-full bg-brand text-white text-xs font-medium"
                    : "h-9 rounded-full bg-surface-soft text-xs font-medium text-ink hover:bg-canvas-deep"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            iconLeft={saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
