"use client";

/**
 * Step 3: Optionen. Umschlag und E-Mail als klare Fragen mit Vorlage-Picker.
 * Preflight-Toggle nur bei with-presentation-Kampagnen (Daniel-Regel).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import type { WizardState } from "./types";

interface Template {
  id: string;
  name: string;
}

export function Step3Options({
  state,
  patch,
  campaignMode,
  pdfEnabled: _pdfEnabled,
  onBack,
  onNext,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  campaignMode: "webcam-only" | "with-presentation";
  pdfEnabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const [envelopes, setEnvelopes] = React.useState<Template[]>([]);
  const [emailTemplates, setEmailTemplates] = React.useState<Template[]>([]);

  React.useEffect(() => {
    void fetch("/api/envelopes")
      .then((r) => r.json())
      .then((b) => setEnvelopes(b.envelopes ?? b.templates ?? b ?? []))
      .catch((err) => toastError(toast, err));
    void fetch("/api/email-templates")
      .then((r) => r.json())
      .then((b) => setEmailTemplates(b.templates ?? b ?? []))
      .catch(() => {}); // E-Mail-Templates sind optional
  }, [toast]);

  function setOpt(update: Partial<WizardState["options"]>) {
    patch({ options: { ...state.options, ...update } });
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold text-ink mb-2">Was soll neben dem Video noch raus?</h2>
      <p className="text-sm text-ink-muted mb-5">
        Alle Antworten gelten nur für diese Runde. Rechts unten kannst du sie als Standard für
        die ganze Kampagne merken.
      </p>

      <div className="space-y-3">
        <QuestionCard
          question="Willst du Umschläge generieren?"
          on={state.options.envelopeEnabled}
          onToggle={(v) => setOpt({ envelopeEnabled: v })}
        >
          <div className="text-xs text-ink-muted mb-1">Vorlage:</div>
          <select
            value={state.options.envelopeTemplateId ?? ""}
            onChange={(e) => setOpt({ envelopeTemplateId: e.target.value || null })}
            className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
            disabled={!state.options.envelopeEnabled}
          >
            <option value="">— Bitte wählen —</option>
            {envelopes.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </QuestionCard>

        <QuestionCard
          question="Willst du die Kontakte per E-Mail benachrichtigen?"
          on={state.options.emailEnabled}
          onToggle={(v) => setOpt({ emailEnabled: v })}
        >
          <div className="text-xs text-ink-muted mb-1">Vorlage:</div>
          <select
            value={state.options.emailTemplateId ?? ""}
            onChange={(e) => setOpt({ emailTemplateId: e.target.value || null })}
            className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
            disabled={!state.options.emailEnabled}
          >
            <option value="">— Bitte wählen —</option>
            {emailTemplates.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </QuestionCard>

        {campaignMode === "with-presentation" && (
          <QuestionCard
            question="Sollen die Webseiten vorab geprüft werden?"
            on={state.options.preflightEnabled}
            onToggle={(v) => setOpt({ preflightEnabled: v })}
          >
            <p className="text-xs text-ink-muted">
              Wir machen erst einen Screenshot der Landingpage. Wenn was komisch aussieht
              (Fehler-Seite, Weiterleitung), meldet die Runde sich bei dir, bevor Videos
              generiert werden.
            </p>
          </QuestionCard>
        )}
      </div>

      <div className="mt-5 p-4 bg-canvas rounded-xl flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.options.saveAsDefault}
          onChange={(e) => setOpt({ saveAsDefault: e.target.checked })}
        />
        <span className="text-sm text-ink">
          Diese Einstellungen als Standard für alle künftigen Runden dieser Kampagne merken.
        </span>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>← Zurück</Button>
        <Button variant="brand" onClick={onNext}>Weiter →</Button>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  on,
  onToggle,
  children,
}: {
  question: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl bg-surface p-4 shadow-card border-2 transition-colors", on ? "border-brand" : "border-transparent")}>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-sm font-semibold text-ink flex-1">{question}</div>
        <button
          type="button"
          onClick={() => onToggle(!on)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            on ? "bg-ok" : "bg-line",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 bg-white rounded-full transition-all",
              on ? "left-[calc(100%-1.375rem)]" : "left-0.5",
            )}
          />
        </button>
      </div>
      {on && children}
    </div>
  );
}
