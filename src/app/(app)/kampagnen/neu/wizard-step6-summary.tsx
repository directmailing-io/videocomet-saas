"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  WizardState,
  WizardWebcam,
  WizardTemplate,
  WizardCustomTemplate,
} from "./wizard-container";

export interface WizardStep6Props {
  state: WizardState;
  webcams: WizardWebcam[];
  templates: WizardTemplate[];
  customTemplates?: WizardCustomTemplate[];
  onNameChange: (name: string) => void;
}

function modeLabel(mode: string): string {
  if (mode === "with-presentation") return "Mit Präsentation";
  return "Nur Webcam";
}

function pipPositionLabel(pos: string): string {
  if (pos === "bottom-right") return "Rechts unten";
  return "Links unten";
}

function pipShapeLabel(shape: string): string {
  if (shape === "circle") return "Rund";
  if (shape === "square") return "Eckig";
  return "Abgerundet";
}

/** Eine Zeile der Quittungs-Liste: Label links, Wert rechts. */
function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5 first:pt-0 last:pb-0">
      <span className="text-sm text-ink-muted shrink-0">{label}</span>
      <div className="text-sm font-medium text-ink text-right">{children}</div>
    </div>
  );
}

export function WizardStep6Summary({
  state,
  webcams,
  templates,
  customTemplates,
  onNameChange,
}: WizardStep6Props) {
  const webcam = webcams.find((w) => w.id === state.webcamMediaId);
  const tpl = templates.find((t) => t.id === state.landingPageTemplateId);
  // Custom-HTML-Vorlage hat Vorrang (analog zur Submit-Logik im Container).
  const customTpl = customTemplates?.find(
    (t) => t.id === state.customLpTemplateId,
  );

  return (
    <div className="space-y-5">
      <div className="rounded-squircle-lg bg-surface shadow-card p-6">
        <Label htmlFor="campaign-name">Kampagnen-Name</Label>
        <Input
          id="campaign-name"
          placeholder="z.B. Outreach Q2 - Anwälte Hamburg"
          value={state.name}
          onChange={(e) => onNameChange(e.target.value)}
          required
        />
      </div>

      <div className="rounded-squircle-lg bg-surface shadow-card p-6">
        <div className="divide-y divide-line-soft">
          <SummaryRow label="Webcam">
            {webcam?.name ?? (
              <span className="font-normal text-ink-muted">Keine</span>
            )}
          </SummaryRow>

          <SummaryRow label="Modus">{modeLabel(state.mode)}</SummaryRow>

          {state.mode === "with-presentation" && (
            <SummaryRow label="Editor">
              <p>{state.segments.length} Segment(e)</p>
              <p className="text-xs font-normal text-ink-muted mt-1">
                PiP: {pipPositionLabel(state.pipPosition)} .{" "}
                {pipShapeLabel(state.pipShape)}
              </p>
            </SummaryRow>
          )}

          <SummaryRow label="Landingpage">
            {customTpl?.name ?? tpl?.name ?? (
              <span className="font-normal text-ink-muted">Keine</span>
            )}
            {customTpl ? (
              <p className="text-xs font-normal text-ink-muted mt-1">
                Eigene HTML-Vorlage
              </p>
            ) : (
              tpl && (
                <p className="text-xs font-normal text-ink-muted mt-1 capitalize">
                  Theme: {tpl.themeId}
                </p>
              )
            )}
          </SummaryRow>

          <SummaryRow label="PDF-Brief">
            {state.pdfEnabled ? "Aktiv" : "Deaktiviert"}
            {state.pdfEnabled && (
              <p className="text-xs font-normal text-ink-muted mt-1">
                QR: {state.pdfQrEnabled ? "Ja" : "Nein"} . Thumbnail:{" "}
                {state.pdfThumbnailEnabled ? "Ja" : "Nein"} . A/B-Test:{" "}
                {state.abTestingEnabled &&
                (state.pdfGoogleDocsUrlB ?? "").trim()
                  ? `Aktiv (Brief A + B, ${state.abSplitWeightA}/${
                      100 - state.abSplitWeightA
                    } ${state.abSplitMode === "sequential" ? "der Reihe nach" : "zufällig"})`
                  : "Nein"}
              </p>
            )}
          </SummaryRow>
        </div>
      </div>
    </div>
  );
}
