"use client";

/**
 * Step 5: Zusammenfassung + Start-Button.
 * Ruft POST /api/campaigns/:id/runs/from-list mit dem gesammelten
 * contactMapping + skipContactIds auf.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import type { WizardState } from "./types";

export function Step5Start({
  state,
  patch,
  campaignId,
  campaignMode: _campaignMode,
  onBack,
  onStarted,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  campaignId: string;
  campaignMode: "webcam-only" | "with-presentation";
  onBack: () => void;
  onStarted: (runId: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const skipContactIds = React.useMemo(() => {
    if (!state.dedupeResults) return [];
    return state.dedupeResults
      .filter((r) => r.matchedContactId && state.dedupeDecisions[r.matchedContactId] === "skip")
      .map((r) => r.matchedContactId!)
      .filter(Boolean);
  }, [state.dedupeResults, state.dedupeDecisions]);

  const totalContacts = state.dedupeResults
    ? state.dedupeResults.length - skipContactIds.length
    : "?";

  async function start() {
    const listId = state.source === "existing-list" ? state.selectedListId : state.targetListId;
    if (!listId) {
      toast({ title: "Keine Liste ausgewählt.", variant: "danger" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/runs/from-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId,
          name: state.runName.trim(),
          contactMapping: state.contactMapping,
          skipContactIds,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error);
      toast({ title: `Runde gestartet — ${body.leadCount} Videos werden erstellt` });
      onStarted(body.runId);
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold text-ink mb-2">Alles klar? Dann los.</h2>
      <p className="text-sm text-ink-muted mb-5">
        Prüfe kurz die Zusammenfassung. Nach dem Start läuft die Video-Produktion.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Tile k="Kontakte" v={String(totalContacts)} big />
        <Tile k="Übersprungen" v={String(skipContactIds.length)} big />
        <Tile
          k="Umschläge"
          v={state.options.envelopeEnabled ? "Ja, mit Vorlage" : "Nein"}
        />
        <Tile
          k="E-Mail-Versand"
          v={state.options.emailEnabled ? "Ja" : "Nein"}
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-ink mb-1">Name der Runde</label>
        <input
          type="text"
          value={state.runName}
          onChange={(e) => patch({ runName: e.target.value })}
          maxLength={120}
          className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
        />
      </div>

      <div className="rounded-xl bg-brand-soft p-4 text-sm text-ink mb-5">
        <strong className="text-brand-deep">Was jetzt passiert:</strong>{" "}
        {state.options.preflightEnabled
          ? "Wir prüfen erst kurz die Erreichbarkeit der Landingpages. "
          : ""}
        Danach starten wir die Video-Produktion. Du siehst alles live in der Runden-Übersicht.
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>← Zurück</Button>
        <Button
          variant="brand"
          onClick={start}
          disabled={busy}
          iconLeft={busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
        >
          {busy ? "Startet…" : "Runde starten"}
        </Button>
      </div>
    </div>
  );
}

function Tile({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className="bg-canvas rounded-xl p-3">
      <div className="text-[11px] text-ink-muted uppercase tracking-wide">{k}</div>
      <div className={"font-bold text-ink " + (big ? "text-2xl mt-1" : "text-base mt-0.5")}>{v}</div>
    </div>
  );
}
