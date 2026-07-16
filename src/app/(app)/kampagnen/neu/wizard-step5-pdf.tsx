"use client";

import * as React from "react";
import {
  Camera,
  FlaskConical,
  Image as ImageIcon,
  MonitorPlay,
  Play,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlaceholderHelper } from "@/components/editor/placeholder-helper";
import { UrlPicker } from "@/components/media-urls/url-picker";
import { DriveRendererBanner } from "@/components/media-urls/drive-renderer-banner";
import { ThumbnailFramePicker } from "@/components/editor/thumbnail-frame-picker";
import {
  ThumbnailImageEditor,
  createDefaultThumbnailImage,
} from "@/components/editor/thumbnail-image-editor";
import type { SegmentEditorMediaItem } from "@/components/editor/segment-editor";
import type { CampaignThumbnailImage } from "@/lib/segments/types";
import { AbSplitPicker, type AbSplitMode } from "@/components/ab/ab-split-picker";
import { cn } from "@/lib/utils";

/**
 * Thumbnail-Modus — Single-Source-of-Truth (Migration 0019):
 *   • 'frame'                  → Standbild aus dem Video
 *   • 'custom_image'           → Personalisierte Folie (Editor)
 *   • 'landingpage_screenshot' → Auto-Screenshot der Lead-LP
 *
 * Der Wizard hält `thumbnailImageEnabled` als computed mirror von
 * `(thumbnailMode === 'custom_image')`, damit bestehender Pipeline-Code
 * (vor Paket B) weiter funktioniert. Die UI selbst rendert ausschließlich
 * den Modus-Zustand.
 */
type ThumbnailMode = "frame" | "custom_image" | "landingpage_screenshot";

export interface WizardStep5PdfPatch {
  pdfEnabled?: boolean;
  pdfGoogleDocsUrl?: string;
  abTestingEnabled?: boolean;
  pdfGoogleDocsUrlB?: string;
  abSplitMode?: AbSplitMode;
  abSplitWeightA?: number;
  pdfQrEnabled?: boolean;
  pdfThumbnailEnabled?: boolean;
  pdfThumbnailFrameMs?: number | null;
  thumbnailImageEnabled?: boolean;
  thumbnailImage?: CampaignThumbnailImage | null;
  thumbnailMode?: ThumbnailMode;
  thumbnailPlayIcon?: boolean;
}

export interface WizardStep5Props {
  enabled: boolean;
  googleDocsUrl: string;
  /** A/B-Test für Brief-Vorlagen — Brief A ist `googleDocsUrl`. */
  abTestingEnabled: boolean;
  googleDocsUrlB: string;
  /** Standard-Verteilung — vorbefüllt den Runden-Wizard, dort überschreibbar. */
  abSplitMode: AbSplitMode;
  abSplitWeightA: number;
  qrEnabled: boolean;
  thumbnailEnabled: boolean;
  frameMs: number | null;
  /** Id of the webcam media item selected in step 1. Used for the live
   *  frame-preview that streams from /api/media/[id]/frame. */
  webcamMediaId: string | null;
  /** Duration of the selected webcam in seconds — for slider max + presets. */
  webcamDurationSec: number | null;
  /** Paket C — Personalisiertes Vorschaubild. */
  thumbnailImageEnabled: boolean;
  thumbnailImage: CampaignThumbnailImage | null;
  /** Migration 0019 — Modus + globales Play-Icon-Overlay. */
  thumbnailMode: ThumbnailMode;
  thumbnailPlayIcon: boolean;
  mediaItems: SegmentEditorMediaItem[];
  onChange: (patch: WizardStep5PdfPatch) => void;
}

export function WizardStep5Pdf({
  enabled,
  googleDocsUrl,
  abTestingEnabled,
  googleDocsUrlB,
  abSplitMode,
  abSplitWeightA,
  qrEnabled,
  thumbnailEnabled,
  frameMs,
  webcamMediaId,
  webcamDurationSec,
  thumbnailImageEnabled,
  thumbnailImage,
  thumbnailMode,
  thumbnailPlayIcon,
  mediaItems,
  onChange,
}: WizardStep5Props) {
  /**
   * Modus-Wechsel — wir patchen `thumbnailMode` als Single-Source-of-Truth
   * UND halten `thumbnailImageEnabled` als computed mirror konsistent. Das
   * ist Übergangs-Logik bis Paket B/C den Pipeline-Code konsequent auf
   * `thumbnailMode` umzieht; bis dahin reagieren bestehende Renderer noch
   * auf das alte Boolean.
   *
   * Beim Wechsel zu 'custom_image' ohne vorhandenes Layout legen wir das
   * Default-Setup an, damit der Editor sofort etwas zeigt. Bestehende
   * Layouts bleiben beim Wechsel weg/zurück erhalten.
   */
  function selectMode(next: ThumbnailMode) {
    if (next === thumbnailMode) return;
    if (next === "custom_image") {
      onChange({
        thumbnailMode: "custom_image",
        thumbnailImageEnabled: true,
        thumbnailImage: thumbnailImage ?? createDefaultThumbnailImage(),
      });
      return;
    }
    onChange({
      thumbnailMode: next,
      thumbnailImageEnabled: false,
    });
  }

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
            <UrlPicker
              id="pdf-docs"
              value={googleDocsUrl}
              onChange={(v) => onChange({ pdfGoogleDocsUrl: v })}
              placeholder="https://docs.google.com/document/d/..."
              types={["gdoc"]}
            />
            <p className="text-xs text-ink-muted mt-1.5">
              Das Dokument muss öffentlich freigegeben sein (mindestens
              "Jeder mit dem Link kann ansehen"). Aus der Mediathek wählbar
              oder als neue URL eintippen.
            </p>
            <DriveRendererBanner />
          </div>

          {/* ── A/B-Test für Brief-Vorlagen ─────────────────────────── */}
          <div className="pt-3 border-t border-line">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                  <FlaskConical className="size-4 text-brand-deep" />
                  A/B-Test für Brief-Vorlagen
                </p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  Teste zwei Brief-Vorlagen gegeneinander. Die Leads jeder
                  Runde werden nach Deiner Regel auf Brief A und Brief B
                  aufgeteilt — die Auswertung siehst Du im Übersicht-Tab der
                  Kampagne.
                </p>
              </div>
              <Switch
                checked={abTestingEnabled}
                onCheckedChange={(v) => onChange({ abTestingEnabled: v })}
              />
            </div>

            {abTestingEnabled && (
              <div className="mt-4 space-y-5">
                <div>
                  <Label htmlFor="pdf-docs-b">Brief B (Google-Docs-URL)</Label>
                  <UrlPicker
                    id="pdf-docs-b"
                    value={googleDocsUrlB}
                    onChange={(v) => onChange({ pdfGoogleDocsUrlB: v })}
                    placeholder="https://docs.google.com/document/d/..."
                    types={["gdoc"]}
                  />
                  <p className="text-xs text-ink-muted mt-1.5">
                    Brief A ist die URL oben.
                  </p>
                </div>
                <div className="rounded-squircle-md border border-line p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      Standard-Verteilung
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                      Gilt als Vorgabe für jede Runde — beim Start einer Runde
                      kannst Du sie jederzeit anpassen.
                    </p>
                  </div>
                  <AbSplitPicker
                    mode={abSplitMode}
                    weightA={abSplitWeightA}
                    onModeChange={(m) => onChange({ abSplitMode: m })}
                    onWeightChange={(w) => onChange({ abSplitWeightA: w })}
                  />
                </div>
              </div>
            )}
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

          {/* ── Vorschaubild im Brief: Toggle + 3 Modi + Play-Icon ─── */}
          <div className="pt-3 border-t border-line">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Thumbnail einbetten
                </p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  Vorschaubild auf der ersten Brief-Seite. Wähle Standbild
                  aus dem Video, eine personalisierte Folie oder einen
                  automatischen Screenshot der Landingpage.
                </p>
              </div>
              <Switch
                checked={thumbnailEnabled}
                onCheckedChange={(v) => {
                  onChange({ pdfThumbnailEnabled: v });
                  // Wenn ausgeschaltet, computed mirror auch zurücksetzen —
                  // Modus bleibt für Wiedereinschalten als „Letzte Wahl"
                  // erhalten, aber der Pipeline-Schalter geht aus.
                  if (!v) {
                    onChange({ thumbnailImageEnabled: false });
                  }
                }}
              />
            </div>

            {thumbnailEnabled && (
              <div className="mt-4 space-y-4">
                {/* ── 3 Modus-Karten (Radio) ─────────────────────────── */}
                <div
                  role="radiogroup"
                  aria-label="Thumbnail-Modus"
                  className="grid grid-cols-1 md:grid-cols-3 gap-2"
                >
                  <ModeCard
                    active={thumbnailMode === "frame"}
                    onClick={() => selectMode("frame")}
                    icon={<Camera className="size-4" />}
                    title="Frame aus Video wählen"
                    description="Standbild zum gewählten Zeitpunkt aus dem Video."
                  />
                  <ModeCard
                    active={thumbnailMode === "custom_image"}
                    onClick={() => selectMode("custom_image")}
                    icon={<ImageIcon className="size-4" />}
                    title="Thumbnail-Folie gestalten"
                    description={
                      <>
                        Personalisierbar mit{" "}
                        <code className="font-mono text-brand-deep">
                          {"{{firstName}}"}
                        </code>
                        ,{" "}
                        <code className="font-mono text-brand-deep">
                          {"{{pageUrl}}"}
                        </code>
                        .
                      </>
                    }
                  />
                  <ModeCard
                    active={thumbnailMode === "landingpage_screenshot"}
                    onClick={() => selectMode("landingpage_screenshot")}
                    icon={<MonitorPlay className="size-4" />}
                    title="Screenshot der Landingpage"
                    description="Automatisch erzeugt — kein Editor nötig. Zeigt die personalisierte Landingpage."
                  />
                </div>

                {/* ── Play-Icon-Overlay (gilt für alle 3 Modi) ────────── */}
                <label
                  className="flex items-start gap-2 cursor-pointer select-none"
                  title="Halbtransparenter Play-Button über dem Thumbnail."
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand"
                    checked={thumbnailPlayIcon}
                    onChange={(e) =>
                      onChange({ thumbnailPlayIcon: e.target.checked })
                    }
                  />
                  <span className="text-xs text-ink-muted italic leading-snug inline-flex items-center gap-1.5">
                    <Play className="size-3 shrink-0" />
                    Play-Icon-Overlay einblenden
                    <span className="text-ink-muted/70 not-italic">
                      — halbtransparenter Play-Button über dem Thumbnail.
                    </span>
                  </span>
                </label>

                {/* ── Modus-spezifischer Editor-Bereich ───────────────── */}
                {thumbnailMode === "frame" && (
                  <div className="pt-2">
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

                {thumbnailMode === "custom_image" &&
                  thumbnailImageEnabled &&
                  thumbnailImage && (
                    <div className="pt-2">
                      <ThumbnailImageEditor
                        value={thumbnailImage}
                        onChange={(next) =>
                          onChange({ thumbnailImage: next })
                        }
                        mediaItems={mediaItems}
                      />
                    </div>
                  )}

                {thumbnailMode === "landingpage_screenshot" && (
                  <div className="pt-2">
                    <div className="rounded-squircle-sm border border-dashed border-line bg-surface-muted/50 p-4 text-xs text-ink-muted leading-relaxed">
                      Die Pipeline rendert pro Lead einen Screenshot der
                      personalisierten Landingpage und bettet ihn als
                      Thumbnail in den Brief ein. Kein weiterer Editor
                      nötig — die Vorlage ist die LP selbst.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Eine einzelne Modus-Karte im 3-er-Grid. */
function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "text-left rounded-squircle-sm border-2 px-3 py-3 transition-colors h-full",
        active
          ? "border-brand bg-brand-soft/40"
          : "border-line bg-surface hover:border-line-dark",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-squircle-sm",
            active
              ? "bg-brand text-white"
              : "bg-surface-muted text-ink-muted",
          )}
        >
          {icon}
        </span>
        <p className="text-sm font-semibold text-ink leading-tight">
          {title}
        </p>
      </div>
      <p className="text-[11px] text-ink-muted leading-snug">{description}</p>
    </button>
  );
}
