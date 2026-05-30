"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlaceholderHelper } from "@/components/editor/placeholder-helper";
import { ThumbnailFramePicker } from "@/components/editor/thumbnail-frame-picker";

export interface WizardStep5PdfPatch {
  pdfEnabled?: boolean;
  pdfGoogleDocsUrl?: string;
  pdfQrEnabled?: boolean;
  pdfThumbnailEnabled?: boolean;
  pdfThumbnailFrameMs?: number | null;
}

export interface WizardStep5Props {
  enabled: boolean;
  googleDocsUrl: string;
  qrEnabled: boolean;
  thumbnailEnabled: boolean;
  frameMs: number | null;
  /** Id of the webcam media item selected in step 1. Used for the live
   *  frame-preview that streams from /api/media/[id]/frame. */
  webcamMediaId: string | null;
  /** Duration of the selected webcam in seconds — for slider max + presets. */
  webcamDurationSec: number | null;
  onChange: (patch: WizardStep5PdfPatch) => void;
}

export function WizardStep5Pdf({
  enabled,
  googleDocsUrl,
  qrEnabled,
  thumbnailEnabled,
  frameMs,
  webcamMediaId,
  webcamDurationSec,
  onChange,
}: WizardStep5Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">PDF-Brief</h2>
      <p className="text-sm text-ink-muted mb-6">
        Optional: erstelle pro Lead einen personalisierten PDF-Brief inklusive
        QR-Code und Thumbnail.
      </p>

      <div className="flex items-center justify-between bg-surface border border-line rounded-squircle-md p-4 mb-4">
        <div>
          <p className="text-sm font-semibold text-ink">
            PDF-Brief aktivieren
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            Pro Lead wird ein PDF generiert und 7 Tage zum Download
            bereitgestellt.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange({ pdfEnabled: v })}
        />
      </div>

      {enabled && (
        <div className="space-y-5 bg-surface border border-line rounded-squircle-md p-5">
          <div>
            <Label htmlFor="pdf-docs">Google-Docs-URL</Label>
            <Input
              id="pdf-docs"
              type="url"
              placeholder="https://docs.google.com/document/d/..."
              value={googleDocsUrl}
              onChange={(e) =>
                onChange({ pdfGoogleDocsUrl: e.target.value })
              }
            />
            <p className="text-xs text-ink-muted mt-1.5">
              Das Dokument muss öffentlich freigegeben sein (mindestens
              "Jeder mit dem Link kann ansehen").
            </p>
          </div>

          <div className="pt-3 border-t border-line space-y-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                Platzhalter & Vorlagen
              </p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                Im PDF-Brief werden Platzhalter wie{" "}
                <code className="font-mono text-brand-deep">
                  {"{{firstName}}"}
                </code>{" "}
                oder{" "}
                <code className="font-mono text-brand-deep">
                  {"{{firma}}"}
                </code>{" "}
                automatisch durch die Daten des jeweiligen Leads ersetzt. Den
                QR-Code und das Video-Thumbnail kannst du als
                Bild-Platzhalter in dein Google Docs einfügen — der Worker
                tauscht sie beim Rendern gegen das echte Lead-spezifische
                Bild aus.
              </p>
            </div>
            <PlaceholderHelper
              googleDocsUrl={googleDocsUrl}
              csvColumns={[]}
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-line">
            <div>
              <p className="text-sm font-semibold text-ink">
                QR-Code einbetten
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                QR für die personalisierte Landingpage.
              </p>
            </div>
            <Switch
              checked={qrEnabled}
              onCheckedChange={(v) => onChange({ pdfQrEnabled: v })}
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-line">
            <div>
              <p className="text-sm font-semibold text-ink">
                Thumbnail einbetten
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                Einzelnes Standbild aus dem Video.
              </p>
            </div>
            <Switch
              checked={thumbnailEnabled}
              onCheckedChange={(v) =>
                onChange({ pdfThumbnailEnabled: v })
              }
            />
          </div>

          {thumbnailEnabled && (
            <div className="pt-3 border-t border-line">
              <ThumbnailFramePicker
                webcamMediaId={webcamMediaId}
                webcamDurationSec={webcamDurationSec}
                value={frameMs}
                onChange={(ms) =>
                  onChange({ pdfThumbnailFrameMs: ms })
                }
                inputId="pdf-frame"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
