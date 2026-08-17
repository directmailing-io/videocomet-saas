"use client";

/**
 * "Runde aus Liste starten"-Modal.
 *
 * User wählt eine Kampagne aus. Danach wird zum v4-Wizard weitergeleitet
 * (mit vorausgewählter Liste + Kampagne). So kann der User Optionen,
 * Mapping und Duplikat-Check pro Runde entscheiden — nicht mehr Ein-Klick-
 * Direktstart ohne Bearbeitungsmöglichkeit. Wichtig für Follow-up-Runden.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";

interface Campaign {
  id: string;
  name: string;
}

interface StartRunModalProps {
  listId: string;
  listName: string;
  contactCount: number;
  onClose: () => void;
  /** Behalten für API-Kompat, wird aber nicht mehr direkt aufgerufen. */
  onStarted?: (runId: string, campaignId: string) => void;
}

export function StartRunModal({
  listId,
  listName,
  contactCount,
  onClose,
}: StartRunModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = React.useState<string>("");
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
        toastError(toast, err);
      } finally {
        setLoadingCampaigns(false);
      }
    })();
  }, [toast]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) return;
    // Weiter zum v4-Wizard mit vorausgewählter Liste.
    // Der Wizard springt dank ?listId= automatisch zu Step 3 (Optionen),
    // weil Import + Duplikat-Check nicht nötig sind.
    router.push(
      `/kampagnen/${campaignId}/runs/neu-v4?listId=${encodeURIComponent(listId)}`,
    );
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
            <h3 className="text-lg font-semibold text-ink">Neue Runde für diese Liste</h3>
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
            <label className="block text-xs font-semibold text-ink mb-1">
              Für welche Kampagne?
            </label>
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

          <div className="rounded-lg bg-canvas-deep px-3 py-2 text-xs text-ink-muted">
            <strong className="text-ink">Was jetzt passiert:</strong> Im nächsten Schritt
            wählst du Umschlag / E-Mail, siehst die Platzhalter deiner Vorlagen und
            startest dann. Deine Kontakte sind schon da, kein neuer Upload nötig.
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
            disabled={!campaignId || contactCount === 0}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep"
          >
            Weiter zu den Optionen →
          </button>
        </div>
      </form>
    </div>
  );
}
