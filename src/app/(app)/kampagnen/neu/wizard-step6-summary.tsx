"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  WizardState,
  WizardWebcam,
  WizardTemplate,
} from "./wizard-container";

export interface WizardStep6Props {
  state: WizardState;
  webcams: WizardWebcam[];
  templates: WizardTemplate[];
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

export function WizardStep6Summary({
  state,
  webcams,
  templates,
  onNameChange,
}: WizardStep6Props) {
  const webcam = webcams.find((w) => w.id === state.webcamMediaId);
  const tpl = templates.find((t) => t.id === state.landingPageTemplateId);

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">Zusammenfassung</h2>
      <p className="text-sm text-ink-muted mb-6">
        Prüfe deine Einstellungen und gib der Kampagne einen Namen.
      </p>

      <div className="mb-6">
        <Label htmlFor="campaign-name">Kampagnen-Name</Label>
        <Input
          id="campaign-name"
          placeholder="z.B. Outreach Q2 - Anwälte Hamburg"
          value={state.name}
          onChange={(e) => onNameChange(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Webcam
            </p>
            <p className="text-sm text-ink">
              {webcam?.name ?? <span className="text-ink-muted">Keine</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Modus
            </p>
            <Badge variant="brand">{modeLabel(state.mode)}</Badge>
          </CardContent>
        </Card>
        {state.mode === "with-presentation" && (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                Editor
              </p>
              <p className="text-sm text-ink">
                {state.segments.length} Segment(e)
              </p>
              <p className="text-xs text-ink-muted mt-1">
                PiP: {pipPositionLabel(state.pipPosition)} .{" "}
                {pipShapeLabel(state.pipShape)}
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Landingpage
            </p>
            <p className="text-sm text-ink">
              {tpl?.name ?? <span className="text-ink-muted">Keine</span>}
            </p>
            {tpl && (
              <p className="text-xs text-ink-muted mt-1 capitalize">
                Theme: {tpl.themeId}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              PDF-Brief
            </p>
            <Badge variant={state.pdfEnabled ? "success" : "neutral"} dot>
              {state.pdfEnabled ? "Aktiv" : "Deaktiviert"}
            </Badge>
            {state.pdfEnabled && (
              <p className="text-xs text-ink-muted mt-2">
                QR: {state.pdfQrEnabled ? "Ja" : "Nein"} . Thumbnail:{" "}
                {state.pdfThumbnailEnabled ? "Ja" : "Nein"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
