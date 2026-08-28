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

  // Doppel-Anschreib-Warnung: Kontakte, die in den letzten 30 Tagen schon
  // Post hatten. Reine Warnung — blockiert nie, User entscheidet.
  const [recentContacted, setRecentContacted] = React.useState<string[] | null>(null);
  const [recentRemoved, setRecentRemoved] = React.useState(false);

  const skipContactIds = React.useMemo(() => {
    if (!state.dedupeResults) return [];
    return state.dedupeResults
      .filter((r) => r.matchedContactId && state.dedupeDecisions[r.matchedContactId] === "skip")
      .map((r) => r.matchedContactId!)
      .filter(Boolean);
  }, [state.dedupeResults, state.dedupeDecisions]);

  const followUpIds = state.followUpContactIds;

  React.useEffect(() => {
    const isFollowUp = !!followUpIds && followUpIds.length > 0;
    const listId = state.source === "existing-list" ? state.selectedListId : state.targetListId;
    if (!isFollowUp && !listId) return;
    let alive = true;
    void fetch("/api/contacts/v2/recently-contacted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isFollowUp ? { contactIds: followUpIds } : { listId }),
        days: 30,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive && body && Array.isArray(body.contactIds)) {
          setRecentContacted(body.contactIds);
        }
      })
      .catch(() => {
        // Warnung ist nie kritisch — ohne Antwort einfach keine Warnung.
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recentRemovedIds = recentRemoved && recentContacted ? recentContacted : [];
  const totalContactsRaw = state.dedupeResults
    ? state.dedupeResults.length - skipContactIds.length
    : followUpIds && followUpIds.length > 0
      ? followUpIds.length
      : null;
  const totalContacts =
    totalContactsRaw !== null
      ? Math.max(totalContactsRaw - recentRemovedIds.length, 0)
      : "?";

  async function start() {
    const isFollowUp = !!followUpIds && followUpIds.length > 0;
    const listId = state.source === "existing-list" ? state.selectedListId : state.targetListId;
    if (!isFollowUp && !listId) {
      toast({ title: "Keine Liste ausgewählt.", variant: "danger" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/runs/from-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Follow-up: frei ausgewählte Kontakte statt Liste (keine Auto-Listen).
          ...(isFollowUp ? { contactIds: followUpIds } : { listId }),
          name: state.runName.trim(),
          contactMapping: state.contactMapping,
          skipContactIds: Array.from(new Set([...skipContactIds, ...recentRemovedIds])),
          // Runden-Overrides: der Wizard fragt in Step 3 nach Umschlag +
          // Vorlage, aber ohne diese Zeilen landete die Auswahl nie im
          // Run (Vorfall 2026-08-20: Umschlag aktiviert, kein PDF erzeugt).
          envelopeTemplateId: state.options.envelopeEnabled
            ? state.options.envelopeTemplateId
            : null,
          autoLabel:
            state.autoLabelEnabled && state.autoLabelName.trim()
              ? state.autoLabelName.trim()
              : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error);
      const skippedNote =
        typeof body.skippedBlockedCount === "number" && body.skippedBlockedCount > 0
          ? ` · ${body.skippedBlockedCount} gesperrte${body.skippedBlockedCount === 1 ? "r Kontakt" : " Kontakte"} übersprungen`
          : "";
      toast({ title: `Runde gestartet — ${body.leadCount} Videos werden erstellt${skippedNote}` });
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

      <div className="bg-surface rounded-2xl shadow-card p-6 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat k="Kontakte" v={String(totalContacts)} tone="ok" />
          <Stat k="Übersprungen" v={String(skipContactIds.length)} tone="muted" />
          <Stat
            k="Umschläge"
            v={state.options.envelopeEnabled ? "Ja" : "Nein"}
            tone={state.options.envelopeEnabled ? "brand" : "muted"}
          />
          <Stat
            k="E-Mail-Versand"
            v={state.options.emailEnabled ? "Ja" : "Nein"}
            tone={state.options.emailEnabled ? "brand" : "muted"}
          />
        </div>

        <div className="mt-8">
          <label className="block text-xs font-semibold text-ink mb-1.5">
            Name der Runde
          </label>
          <input
            type="text"
            value={state.runName}
            onChange={(e) => patch({ runName: e.target.value })}
            maxLength={120}
            className="w-full px-3 py-2.5 rounded-xl border border-line bg-canvas text-sm focus:outline-none focus:border-brand"
          />
        </div>

        <div className="mt-8">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={state.autoLabelEnabled}
              onChange={(e) => patch({ autoLabelEnabled: e.target.checked })}
              className="mt-0.5 size-4 rounded border-line accent-brand"
            />
            <span className="text-sm text-ink">
              <span className="font-semibold">Kontakte mit Label markieren</span>
              <span className="block text-xs text-ink-muted mt-0.5">
                Alle Kontakte dieser Runde bekommen ein Label. So siehst du in
                „Kontakte &amp; Listen" später sofort, wer schon angeschrieben wurde.
              </span>
            </span>
          </label>
          {state.autoLabelEnabled ? (
            <input
              type="text"
              value={state.autoLabelName}
              onChange={(e) => patch({ autoLabelName: e.target.value })}
              maxLength={60}
              placeholder={`Versand ${new Date().toLocaleDateString("de-DE")}`}
              className="mt-2.5 ml-[26px] w-full max-w-xs px-3 py-2 rounded-xl border border-line bg-canvas text-sm focus:outline-none focus:border-brand"
            />
          ) : null}
        </div>
      </div>

      {recentContacted && recentContacted.length > 0 && !recentRemoved && (
        <div className="rounded-2xl bg-warn-soft p-4 text-sm text-ink mb-5 flex flex-wrap items-center gap-3">
          <span>
            ⚠ <strong>{recentContacted.length}</strong>{" "}
            {recentContacted.length === 1
              ? "Kontakt hatte in den letzten 30 Tagen schon Post von dir."
              : "Kontakte hatten in den letzten 30 Tagen schon Post von dir."}{" "}
            Du kannst sie trotzdem anschreiben — oder rausnehmen.
          </span>
          <button
            type="button"
            onClick={() => setRecentRemoved(true)}
            className="px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-semibold hover:bg-brand-deep"
          >
            Diese {recentContacted.length} entfernen
          </button>
        </div>
      )}
      {recentRemoved && recentContacted && recentContacted.length > 0 && (
        <div className="rounded-2xl bg-canvas-deep p-4 text-sm text-ink-muted mb-5 flex flex-wrap items-center gap-3">
          <span>
            {recentContacted.length}{" "}
            {recentContacted.length === 1 ? "Kontakt" : "Kontakte"} mit Post in
            den letzten 30 Tagen werden übersprungen.
          </span>
          <button
            type="button"
            onClick={() => setRecentRemoved(false)}
            className="text-xs font-semibold underline hover:text-ink"
          >
            Doch mitnehmen
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-brand-soft p-4 text-sm text-ink mb-5">
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

function Stat({ k, v, tone }: { k: string; v: string; tone: "ok" | "brand" | "muted" }) {
  const valueClass =
    tone === "ok" ? "text-ok" :
    tone === "brand" ? "text-brand-deep" :
    "text-ink";
  return (
    <div>
      <div className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">
        {k}
      </div>
      <div className={"text-2xl font-bold mt-1 tabular-nums " + valueClass}>{v}</div>
    </div>
  );
}
