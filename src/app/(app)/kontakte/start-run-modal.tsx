"use client";

/**
 * "Runde aus Liste starten"-Modal (Mini-CRM Etappe 6a).
 *
 * Wird von der Kontakte-Ansicht geöffnet wenn eine Liste ausgewählt ist.
 * User wählt Kampagne + optional Namen für die Runde, klickt "Starten" —
 * Server legt Run + Leads an und startet die Pipeline.
 */

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/toaster";

interface Campaign {
  id: string;
  name: string;
}

interface StartRunModalProps {
  listId: string;
  listName: string;
  contactCount: number;
  onClose: () => void;
  onStarted: (runId: string, campaignId: string) => void;
}

export function StartRunModal({
  listId,
  listName,
  contactCount,
  onClose,
  onStarted,
}: StartRunModalProps) {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = React.useState<string>("");
  const [runName, setRunName] = React.useState(
    `Aus "${listName}" · ${new Date().toLocaleDateString("de-DE")}`,
  );
  const [busy, setBusy] = React.useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns");
        const body = await res.json();
        const items = (body.campaigns ?? body ?? []) as Array<{
          id: string;
          name: string;
        }>;
        setCampaigns(items);
        if (items[0]) setCampaignId(items[0].id);
      } catch (err) {
        toast({
          title: "Kampagnen konnten nicht geladen werden",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      } finally {
        setLoadingCampaigns(false);
      }
    })();
  }, [toast]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/runs/from-list`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId, name: runName.trim() }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Starten");
      toast({
        title: `Runde gestartet — ${body.leadCount} Videos werden erstellt`,
      });
      onStarted(body.runId, campaignId);
    } catch (err) {
      toast({
        title: "Runde konnte nicht gestartet werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-xl"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-ink">Runde aus Liste starten</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {contactCount} Kontakt{contactCount === 1 ? "" : "e"} aus <strong>{listName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-canvas"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">Kampagne</label>
            {loadingCampaigns ? (
              <div className="text-xs text-ink-muted">Kampagnen werden geladen…</div>
            ) : campaigns.length === 0 ? (
              <p className="text-xs text-danger">
                Du hast noch keine Kampagne. Bitte erst eine anlegen.
              </p>
            ) : (
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Name der Runde
            </label>
            <input
              type="text"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              maxLength={120}
              className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
            />
          </div>

          <div className="rounded-lg bg-canvas-deep px-3 py-2 text-xs text-ink-muted">
            <strong className="text-ink">Was jetzt passiert:</strong> Für jeden Kontakt der
            Liste wird ein Video und (falls in der Kampagne aktiviert) ein PDF-Brief
            erstellt. Du kannst den Fortschritt live in der Runde verfolgen.
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-ink-muted hover:bg-canvas"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={busy || !campaignId || contactCount === 0}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep flex items-center gap-2"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Runde starten
          </button>
        </div>
      </form>
    </div>
  );
}
