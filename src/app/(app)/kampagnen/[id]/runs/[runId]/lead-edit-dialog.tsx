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

  const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));

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
            Korrigiere einzelne Felder und wähle optional aus, was direkt
            danach neu generiert werden soll.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 space-y-3 py-1">
          {keys.length === 0 ? (
            <p className="text-sm text-ink-muted">Keine Daten vorhanden.</p>
          ) : (
            keys.map((k) => (
              <div key={k} className="grid grid-cols-[180px_1fr] items-center gap-3">
                <Label htmlFor={`lead-${k}`} className="text-xs text-ink-muted truncate">
                  {k}
                </Label>
                <Input
                  id={`lead-${k}`}
                  value={values[k] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
            ))
          )}
        </div>

        <div className="border-t border-line pt-4 space-y-2">
          <Label className="text-xs">Nach dem Speichern automatisch neu generieren</Label>
          <div className="grid grid-cols-4 gap-1">
            {[
              { key: null as const, label: "Nur speichern" },
              { key: "pdf" as const, label: "+ PDF neu" },
              { key: "envelope" as const, label: "+ Umschlag" },
              { key: "all" as const, label: "+ Alles neu" },
            ].map((o) => (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => setRegenAfter(o.key)}
                className={
                  regenAfter === o.key
                    ? "h-9 rounded-squircle-sm border border-brand bg-brand text-white text-xs font-medium"
                    : "h-9 rounded-squircle-sm border border-line text-xs font-medium text-ink hover:bg-line-soft"
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
