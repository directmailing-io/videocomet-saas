"use client";

import * as React from "react";
import { Loader2, ImageOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlaceholderHelper } from "@/components/editor/placeholder-helper";

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
  onChange: (patch: WizardStep5PdfPatch) => void;
}

export function WizardStep5Pdf({
  enabled,
  googleDocsUrl,
  qrEnabled,
  thumbnailEnabled,
  frameMs,
  webcamMediaId,
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
            <div className="pt-3 border-t border-line grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
              <div>
                <Label htmlFor="pdf-frame">Frame-Zeit (ms)</Label>
                <Input
                  id="pdf-frame"
                  type="number"
                  min={0}
                  step={100}
                  placeholder="3000"
                  value={frameMs ?? ""}
                  onChange={(e) =>
                    onChange({
                      pdfThumbnailFrameMs: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
                <p className="text-xs text-ink-muted mt-1.5">
                  Zeitpunkt im Video, an dem das Thumbnail extrahiert wird.
                </p>
              </div>

              <FramePreview
                webcamMediaId={webcamMediaId}
                frameMs={frameMs}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live frame preview ───────────────────────────────────────────────────────

interface FramePreviewProps {
  webcamMediaId: string | null;
  frameMs: number | null;
}

/**
 * Renders a 16:9 preview of the JPG frame that the server extracts at
 * `frameMs`. The src changes are debounced by 300ms so the user can type a
 * value (or drag a future slider) without hammering ffmpeg on every keystroke.
 *
 * State machine:
 *   - no webcam selected  → placeholder hint
 *   - debouncing / loading → spinner
 *   - loaded               → <img>
 *   - error                → fallback icon + message
 */
function FramePreview({ webcamMediaId, frameMs }: FramePreviewProps) {
  // Hand-rolled debounce — keeping deps to a minimum, no lodash. Effect
  // schedules a 300ms timer that commits the latest (id, ms) tuple as the
  // *displayed* src. If the user types again before the timer fires, the
  // cleanup cancels it.
  const [debouncedMs, setDebouncedMs] = React.useState<number | null>(frameMs);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedMs(frameMs), 300);
    return () => clearTimeout(t);
  }, [frameMs]);

  const [status, setStatus] = React.useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );

  // Effective ms used for the request. We default to 0 if the field is empty
  // so the user still sees the first frame; that matches what the worker
  // would do if frameMs was nullish at render time.
  const effectiveMs =
    debouncedMs !== null && Number.isFinite(debouncedMs) && debouncedMs >= 0
      ? Math.round(debouncedMs)
      : 0;

  const src = webcamMediaId
    ? `/api/media/${webcamMediaId}/frame?ms=${effectiveMs}`
    : null;

  // When the src changes, flip back to "loading" so the spinner re-appears
  // even if the previous image is still in the DOM (browser cache might
  // serve it before onLoad fires — that's fine, the spinner just blinks).
  React.useEffect(() => {
    if (src) setStatus("loading");
  }, [src]);

  return (
    <div className="md:w-64">
      <p className="text-xs font-medium text-ink mb-1.5">
        Vorschau des Frames
      </p>
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm border border-line bg-surface-muted">
        {!webcamMediaId ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink-muted p-3 text-center">
            <ImageOff className="size-5" />
            <span className="text-[11px] leading-tight">
              Wähle in Schritt 1 eine Webcam-Aufnahme, um den Frame zu
              sehen.
            </span>
          </div>
        ) : (
          <>
            {status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-muted/80 backdrop-blur-sm z-10">
                <Loader2 className="size-5 animate-spin text-ink-muted" />
              </div>
            )}
            {status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink-muted p-3 text-center z-10">
                <ImageOff className="size-5" />
                <span className="text-[11px] leading-tight">
                  Frame konnte nicht geladen werden.
                </span>
              </div>
            )}
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`Frame bei ${effectiveMs} ms`}
                className="absolute inset-0 h-full w-full object-cover"
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
              />
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-ink-muted mt-1.5 text-center">
        Live-Vorschau bei {effectiveMs} ms
      </p>
    </div>
  );
}
