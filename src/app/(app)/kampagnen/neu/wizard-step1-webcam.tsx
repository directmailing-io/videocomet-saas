"use client";

import * as React from "react";
import { Video, Check, Upload, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { WebcamRecorder } from "@/components/ui/webcam-recorder";
import { cn } from "@/lib/utils";

interface Webcam {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

export interface WizardStep1Props {
  webcams: Webcam[];
  value: string | null;
  onChange: (id: string) => void;
}

interface MediaApiItem {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

function durationLabel(seconds: number | null): string {
  if (!seconds) return "Webcam";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function WizardStep1Webcam({
  webcams: initialWebcams,
  value,
  onChange,
}: WizardStep1Props) {
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [webcams, setWebcams] = React.useState<Webcam[]>(initialWebcams);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  const selected = React.useMemo(
    () => webcams.find((w) => w.id === value) ?? null,
    [webcams, value],
  );

  // When the user opens the picker, refresh the webcam list from the API so
  // newly uploaded items appear without a full page reload.
  const loadPickerItems = React.useCallback(async () => {
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await fetch("/api/media?type=webcam", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: MediaApiItem[] };
      setWebcams(
        (data.items ?? []).map((it) => ({
          id: it.id,
          name: it.name,
          publicUrl: it.publicUrl,
          durationSec: it.durationSec ?? null,
        })),
      );
    } catch (err) {
      console.error("[wizard-step1] load media failed:", err);
      setPickerError(
        err instanceof Error
          ? err.message
          : "Mediathek konnte nicht geladen werden.",
      );
    } finally {
      setPickerLoading(false);
    }
  }, []);

  function openPicker() {
    setPickerOpen(true);
    void loadPickerItems();
  }

  async function handleRecorderConfirm(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "webcam");

      const res = await fetch("/api/media", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) detail = json.error;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      const json = (await res.json()) as {
        media: {
          id: string;
          name: string;
          publicUrl: string;
          durationSec: number | null;
        };
      };

      const newItem: Webcam = {
        id: json.media.id,
        name: json.media.name,
        publicUrl: json.media.publicUrl,
        durationSec: json.media.durationSec ?? null,
      };
      setWebcams((prev) => [newItem, ...prev]);
      onChange(newItem.id);
      setRecordOpen(false);
    } catch (err) {
      console.error("[wizard-step1] upload failed:", err);
      setUploadError(
        err instanceof Error ? err.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">
        Webcam-Video wählen
      </h2>
      <p className="text-sm text-ink-muted mb-6">
        Wähle eine vorhandene Aufnahme aus deiner Mediathek oder nimm jetzt
        eine neue auf.
      </p>

      {selected ? (
        <div className="rounded-squircle-md border border-line bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep">
              <Check className="size-3.5" />
              Ausgewählt
            </span>
            <span className="text-sm font-semibold text-ink truncate">
              {selected.name}
            </span>
            <span className="text-xs text-ink-muted">
              {durationLabel(selected.durationSec)}
            </span>
          </div>
          <video
            key={selected.id}
            src={selected.publicUrl}
            controls
            className="w-full max-w-[480px] rounded-squircle-sm bg-ink"
          />
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={openPicker}
              iconLeft={<RotateCcw className="size-4" />}
            >
              Andere wählen
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                setUploadError(null);
                setRecordOpen(true);
              }}
              iconLeft={<Video className="size-4" />}
            >
              Neu aufnehmen
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink-muted">
              {webcams.length === 0
                ? "Du hast noch keine Webcam-Aufnahme."
                : "Wähle eine Webcam aus deiner Mediathek."}
            </div>
            <div className="flex flex-wrap gap-2">
              {webcams.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openPicker}
                  iconLeft={<Upload className="size-4" />}
                >
                  Aus Mediathek wählen
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setUploadError(null);
                  setRecordOpen(true);
                }}
                iconLeft={<Video className="size-4" />}
              >
                Neu aufnehmen
              </Button>
            </div>
          </div>

          {webcams.length === 0 ? (
            <EmptyState
              icon={<Video />}
              title="Keine Webcam-Aufnahmen"
              subtitle="Nimm jetzt deine erste Webcam-Aufnahme auf, um sie hier auswaehlen zu können."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {webcams.map((w) => {
                const active = w.id === value;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onChange(w.id)}
                    className={cn(
                      "text-left rounded-squircle-md border transition-all duration-200 ease-spring",
                      active
                        ? "border-brand ring-2 ring-brand/30"
                        : "border-line hover:border-brand/50",
                    )}
                  >
                    <Card className="border-0 shadow-none">
                      <CardContent className="p-3">
                        <div className="aspect-video rounded-squircle-sm bg-ink mb-2 overflow-hidden flex items-center justify-center text-white/50 text-xs">
                          <video
                            src={w.publicUrl}
                            preload="metadata"
                            muted
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <p className="text-sm font-semibold text-ink truncate">
                          {w.name}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {durationLabel(w.durationSec)}
                        </p>
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Picker dialog (Mediathek) */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Aus Mediathek wählen</DialogTitle>
            <DialogDescription>
              Klicke eine Webcam-Aufnahme an, um sie für diese Kampagne zu
              verwenden.
            </DialogDescription>
          </DialogHeader>
          {pickerLoading ? (
            <div className="py-12 text-center text-sm text-ink-muted">
              Lade ...
            </div>
          ) : pickerError ? (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 p-6 text-center">
              <p className="text-sm font-semibold text-ink mb-1">
                Mediathek konnte nicht geladen werden
              </p>
              <p className="text-xs text-ink-muted mb-3">{pickerError}</p>
              <Button size="sm" onClick={loadPickerItems}>
                Erneut versuchen
              </Button>
            </div>
          ) : webcams.length === 0 ? (
            <EmptyState
              icon={<Video />}
              title="Keine Webcam-Aufnahmen"
              subtitle="Nimm jetzt deine erste Webcam-Aufnahme auf."
              action={
                <Button
                  onClick={() => {
                    setPickerOpen(false);
                    setUploadError(null);
                    setRecordOpen(true);
                  }}
                  iconLeft={<Video className="size-4" />}
                >
                  Neu aufnehmen
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
              {webcams.map((w) => {
                const active = w.id === value;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      onChange(w.id);
                      setPickerOpen(false);
                    }}
                    className={cn(
                      "text-left rounded-squircle-md border transition-all duration-200 ease-spring",
                      active
                        ? "border-brand ring-2 ring-brand/30"
                        : "border-line hover:border-brand/50",
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="aspect-video rounded-squircle-sm bg-ink mb-2 overflow-hidden">
                        <video
                          src={w.publicUrl}
                          preload="metadata"
                          muted
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-sm font-semibold text-ink truncate">
                        {w.name}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {durationLabel(w.durationSec)}
                      </p>
                    </CardContent>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recorder dialog */}
      <Dialog
        open={recordOpen}
        onOpenChange={(o) => {
          if (uploading) return;
          setRecordOpen(o);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Webcam-Aufnahme</DialogTitle>
            <DialogDescription>
              Achte auf gute Beleuchtung und ein neutrales Setup. Maximal 2
              Minuten.
            </DialogDescription>
          </DialogHeader>
          {uploadError && (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {uploadError}
            </div>
          )}
          {uploading && (
            <div className="rounded-squircle-md border border-line bg-surface-soft px-4 py-3 text-sm text-ink-muted flex items-center gap-2">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              Upload läuft ...
            </div>
          )}
          {recordOpen && (
            <WebcamRecorder
              onConfirm={handleRecorderConfirm}
              onCancel={() => {
                if (!uploading) setRecordOpen(false);
              }}
              maxDurationSec={120}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
