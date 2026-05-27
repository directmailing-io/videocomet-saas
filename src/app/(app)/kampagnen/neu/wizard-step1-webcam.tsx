"use client";

import * as React from "react";
import { Video, Circle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
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

export function WizardStep1Webcam({ webcams, value, onChange }: WizardStep1Props) {
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);

  React.useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error("getUserMedia error", err);
    }
  }

  async function startRecording() {
    if (!streamRef.current) await startCamera();
    if (!streamRef.current) return;
    chunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current, {
      mimeType: "video/webm",
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const form = new FormData();
      form.append("file", blob, `webcam-${Date.now()}.webm`);
      form.append("type", "webcam");
      try {
        const res = await fetch("/api/media", { method: "POST", body: form });
        if (!res.ok) {
          console.log("TODO API endpoint /api/media POST", res.status);
        }
      } catch (err) {
        console.log("TODO API endpoint /api/media POST", err);
      }
    };
    rec.start();
    mediaRecorderRef.current = rec;
    setRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    setRecordOpen(false);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">
        Webcam-Video waehlen
      </h2>
      <p className="text-sm text-ink-muted mb-6">
        Waehle eine vorhandene Aufnahme aus deiner Mediathek oder nimm jetzt
        eine neue auf.
      </p>

      <div className="flex justify-end mb-4">
        <Dialog
          open={recordOpen}
          onOpenChange={(o) => {
            setRecordOpen(o);
            if (o) startCamera();
            else {
              streamRef.current?.getTracks().forEach((t) => t.stop());
              streamRef.current = null;
            }
          }}
        >
          <DialogTrigger asChild>
            <Button iconLeft={<Video className="size-4" />}>
              Neu aufnehmen
            </Button>
          </DialogTrigger>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>Webcam-Aufnahme</DialogTitle>
              <DialogDescription>
                Achte auf gute Beleuchtung und ein neutrales Setup.
              </DialogDescription>
            </DialogHeader>
            <div className="aspect-video w-full rounded-squircle-md bg-ink overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
            </div>
            <DialogFooter>
              {!recording ? (
                <Button
                  onClick={startRecording}
                  iconLeft={<Circle className="size-4 fill-current" />}
                >
                  Aufnahme starten
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={stopRecording}
                  iconLeft={<Square className="size-4 fill-current" />}
                >
                  Stopp
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {webcams.length === 0 ? (
        <EmptyState
          icon={<Video />}
          title="Keine Webcam-Aufnahmen"
          subtitle="Nimm jetzt deine erste Webcam-Aufnahme auf, um sie hier auswaehlen zu koennen."
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
                  "text-left rounded-squircle-md border transition-all",
                  active
                    ? "border-brand ring-2 ring-brand/30"
                    : "border-line hover:border-brand/50",
                )}
              >
                <Card className="border-0 shadow-none">
                  <CardContent className="p-3">
                    <div className="aspect-video rounded-squircle-sm bg-ink mb-2 flex items-center justify-center text-white/50 text-xs">
                      Video
                    </div>
                    <p className="text-sm font-semibold text-ink truncate">
                      {w.name}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {w.durationSec ? `${w.durationSec}s` : "Webcam"}
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
