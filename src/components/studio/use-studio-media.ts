"use client";

/**
 * use-studio-media — getUserMedia-Stream für den Studio-Flow.
 *
 * Lebt auf Flow-Ebene, damit der Stream Phasenwechsel (Bereit-Check →
 * Live-Aufnahme) überlebt. Fehlertexte laienverständlich, Muster aus
 * webcam-recorder.tsx.
 */

import * as React from "react";

export interface StudioMediaDevice {
  deviceId: string;
  label: string;
}

export interface UseStudioMediaResult {
  stream: MediaStream | null;
  error: string | null;
  initializing: boolean;
  cameras: StudioMediaDevice[];
  microphones: StudioMediaDevice[];
  cameraId: string | null;
  microphoneId: string | null;
  /** (Neu-)Initialisierung, optional mit expliziter Geräte-Wahl. */
  init: (opts?: {
    cameraId?: string | null;
    microphoneId?: string | null;
  }) => Promise<void>;
  /** Alle Tracks stoppen (Kamera-LED aus). */
  stop: () => void;
}

function friendlyMediaError(err: unknown): string {
  const name =
    err instanceof Error && "name" in err ? (err as Error).name : "Error";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Zugriff auf Kamera und Mikrofon wurde verweigert. Bitte erlaube den Zugriff über das Kamera-Symbol in der Adressleiste deines Browsers und versuche es erneut.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Keine Kamera oder kein Mikrofon gefunden. Bitte schließe ein Gerät an und versuche es erneut.";
  }
  if (name === "NotReadableError") {
    return "Kamera oder Mikrofon werden bereits von einer anderen Anwendung verwendet. Bitte schließe z. B. Zoom oder Teams und versuche es erneut.";
  }
  return "Kamera und Mikrofon konnten nicht gestartet werden. Bitte versuche es erneut.";
}

export function useStudioMedia(): UseStudioMediaResult {
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [initializing, setInitializing] = React.useState(false);
  const [cameras, setCameras] = React.useState<StudioMediaDevice[]>([]);
  const [microphones, setMicrophones] = React.useState<StudioMediaDevice[]>([]);
  const [cameraId, setCameraId] = React.useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = React.useState<string | null>(null);

  const streamRef = React.useRef<MediaStream | null>(null);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const init = React.useCallback(
    async (opts?: {
      cameraId?: string | null;
      microphoneId?: string | null;
    }) => {
      setError(null);
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setError(
          "Dein Browser unterstützt keine Kamera-Aufnahmen. Bitte nutze einen aktuellen Chrome, Edge oder Firefox am Desktop.",
        );
        return;
      }
      setInitializing(true);
      // Alten Stream erst stoppen — sonst blockiert die Kamera sich selbst.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);

      const wantCam = opts?.cameraId ?? cameraId;
      const wantMic = opts?.microphoneId ?? microphoneId;

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
            aspectRatio: { ideal: 16 / 9 },
            facingMode: { ideal: "user" },
            ...(wantCam ? { deviceId: { exact: wantCam } } : {}),
          },
          audio: wantMic ? { deviceId: { exact: wantMic } } : true,
        });
        streamRef.current = s;
        setStream(s);
        setCameraId(s.getVideoTracks()[0]?.getSettings().deviceId ?? wantCam);
        setMicrophoneId(
          s.getAudioTracks()[0]?.getSettings().deviceId ?? wantMic,
        );

        // Geräte-Liste erst NACH erteilter Permission — sonst sind Labels leer.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setCameras(
            devices
              .filter((d) => d.kind === "videoinput")
              .map((d, i) => ({
                deviceId: d.deviceId,
                label: d.label || `Kamera ${i + 1}`,
              })),
          );
          setMicrophones(
            devices
              .filter((d) => d.kind === "audioinput")
              .map((d, i) => ({
                deviceId: d.deviceId,
                label: d.label || `Mikrofon ${i + 1}`,
              })),
          );
        } catch {
          /* Geräteliste ist optional */
        }
      } catch (err) {
        console.error("[studio] getUserMedia failed:", err);
        setError(friendlyMediaError(err));
      } finally {
        setInitializing(false);
      }
    },
    [cameraId, microphoneId],
  );

  // Cleanup beim Unmount des Flows.
  React.useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    stream,
    error,
    initializing,
    cameras,
    microphones,
    cameraId,
    microphoneId,
    init,
    stop,
  };
}
