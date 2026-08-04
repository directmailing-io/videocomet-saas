"use client";

/**
 * Einstellungen-Tab "KI-Stimme" — Setup und Verwaltung des Voice-Clones
 * für die personalisierte Video-Begrüßung.
 *
 * Zustände (getrieben von GET /api/voice-profile):
 *   kein Profil / pending_sample → Empty-State mit 3-Schritte-Promise
 *   Setup-Flow (inline)          → Aufnahme (MediaRecorder oder Upload)
 *                                  → Einwilligung (2 Pflicht-Checkboxen)
 *   processing                   → Poll alle 5s bis ready/failed
 *   ready                        → Erfolgskarte + dezente Lösch-Option
 *   failed                       → Fehlerkarte mit deutschem Hinweis
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  Circle,
  Mic,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

// ── Vertrag mit GET /api/voice-profile ────────────────────────────────────

interface VoiceProfileDto {
  id: string;
  status: "pending_sample" | "processing" | "ready" | "failed";
  sampleUrl: string | null;
  sampleDurationSec: number | null;
  consentVoiceAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VoiceProfileResponse {
  profile: VoiceProfileDto | null;
}

const MIN_SECONDS = 30;
const MAX_SECONDS = 240;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const READING_SCRIPT =
  "Hallo und schön, dass du dir das Video anschaust. Ich möchte dir heute kurz zeigen, wie wir bei uns arbeiten und warum das für dich spannend sein könnte. Hallo Jürgen. Hallo Herr Schmitz. Hallo Frau Müller. Guten Tag, Herr Yilmaz. Hi Alexandra. Schön, dass Sie reinschauen. Viele unserer Kunden fragen sich am Anfang, ob sich der Aufwand überhaupt lohnt. Die ehrliche Antwort ist: Es kommt darauf an, was du erreichen willst. Zahlen und Fakten sind wichtig: dreiundzwanzig Prozent mehr Antworten, vierhundert Euro gespart, am siebten Oktober um halb zehn. Ich freue mich, wenn wir uns kennenlernen. Bis gleich!";

const CONSENT_VOICE_TEXT =
  "Ich willige ausdrücklich ein, dass VIDEOCOMET aus meinen Aufnahmen ein digitales Stimmmodell erstellt und dieses ausschließlich für meine personalisierten Videobegrüßungen verwendet. Es handelt sich dabei um biometrische Daten (Art. 9 DSGVO). Verarbeitung durch die in der Datenschutzerklärung genannten Dienstleister. Ich kann diese Einwilligung jederzeit widerrufen, mein Stimmmodell wird dann gelöscht.";

const CONSENT_AI_TEXT =
  "Mir ist bekannt, dass die personalisierte Begrüßung mit KI-Technologie erzeugt wird und die Qualität schwanken kann. Vor jeder Produktion prüfe und genehmige ich Beispielvideos. Mit dieser Freigabe akzeptiere ich die gezeigte Qualität als vertragsgemäß.";

/** Fehler-Codes des Voice-Training-Workers → deutsche Hinweise. */
function trainingErrorHint(code: string | null): string {
  switch (code) {
    case "too_quiet":
      return "Die Aufnahme ist zu leise. Bitte nimm sie näher am Mikrofon neu auf.";
    case "too_short":
      return "Die Aufnahme ist zu kurz, bitte sprich mindestens 30 Sekunden.";
    default:
      return "Das Training ist fehlgeschlagen. Bitte nimm eine neue Stimmprobe auf.";
  }
}

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(safe / 60);
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "audio/webm";
}

// ── Haupt-Komponente ─────────────────────────────────────────────────────

export function KiStimmeTab() {
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<VoiceProfileDto | null>(null);
  const [setupActive, setSetupActive] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/voice-profile", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as VoiceProfileResponse;
      setProfile(data.profile);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Polling alle 5s solange das Training läuft.
  React.useEffect(() => {
    if (profile?.status !== "processing") return;
    const handle = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(handle);
  }, [profile?.status, load]);

  // Toast beim Übergang processing → ready.
  const prevStatusRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = profile?.status ?? null;
    if (prev === "processing" && profile?.status === "ready") {
      toast({
        title: "Deine KI-Stimme ist bereit",
        description: "Du kannst sie jetzt in deinen Kampagnen aktivieren.",
        variant: "success",
      });
    }
  }, [profile?.status, toast]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Wird geladen ...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (profile?.status === "processing") {
    return <ProcessingCard />;
  }

  if (profile?.status === "ready") {
    return (
      <ReadyCard
        profile={profile}
        onDeleted={() => {
          setProfile(null);
          setSetupActive(false);
        }}
      />
    );
  }

  if (profile?.status === "failed" && !setupActive) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-squircle-sm bg-danger-soft text-danger">
              <AlertCircle className="size-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">
                Training fehlgeschlagen
              </p>
              <p className="text-sm text-ink-muted mt-1 leading-relaxed">
                {trainingErrorHint(profile.error)}
              </p>
              <div className="mt-4">
                <Button
                  size="sm"
                  iconLeft={<Mic className="size-4" />}
                  onClick={() => setSetupActive(true)}
                >
                  Neue Stimmprobe aufnehmen
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (setupActive) {
    return (
      <SetupFlow
        onCancel={() => setSetupActive(false)}
        onSubmitted={(p) => {
          setProfile(p);
          setSetupActive(false);
        }}
      />
    );
  }

  return <IntroEmptyState onStart={() => setSetupActive(true)} />;
}

// ── Empty-State ──────────────────────────────────────────────────────────

function IntroEmptyState({ onStart }: { onStart: () => void }) {
  const steps = [
    { n: 1, label: "Aufnahme", hint: "1 bis 2 Minuten vorlesen" },
    { n: 2, label: "Einwilligung", hint: "Zwei Häkchen setzen" },
    { n: 3, label: "Fertig", hint: "VIDEOCOMET trainiert deine Stimme" },
  ];
  return (
    <Card>
      <CardContent className="p-8 sm:p-10">
        <div className="max-w-xl mx-auto text-center">
          <Badge variant="brand" className="mb-4">
            <Sparkles className="size-3" />
            KI
          </Badge>
          <h2 className="text-xl sm:text-2xl font-bold text-ink leading-tight">
            Begrüße jeden Empfänger persönlich.
            <br />
            Mit deiner echten Stimme.
          </h2>
          <p className="text-sm text-ink-muted mt-3 leading-relaxed">
            Einmal aufnehmen, danach spricht dein Video jeden Lead mit
            Vornamen an. Automatisch, in deiner Stimme.
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {steps.map((s) => (
              <div
                key={s.n}
                className="flex flex-col items-center gap-2 rounded-squircle-sm bg-surface-soft px-4 py-5"
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep text-sm font-bold">
                  {s.n}
                </span>
                <p className="text-sm font-semibold text-ink">{s.label}</p>
                <p className="text-xs text-ink-muted leading-snug">{s.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <Button
              size="lg"
              iconLeft={<Mic className="size-4" />}
              onClick={onStart}
            >
              Stimmprobe aufnehmen
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Processing ───────────────────────────────────────────────────────────

function ProcessingCard() {
  return (
    <Card>
      <CardContent className="p-8">
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <span className="inline-flex size-12 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
          <p className="text-base font-semibold text-ink">
            Deine KI-Stimme wird trainiert
          </p>
          <p className="text-sm text-ink-muted max-w-sm leading-relaxed">
            Das dauert in der Regel wenige Minuten. Du kannst diese Seite
            verlassen, wir arbeiten im Hintergrund weiter.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Ready ────────────────────────────────────────────────────────────────

function ReadyCard({
  profile,
  onDeleted,
}: {
  profile: VoiceProfileDto;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const sampleDate = profile.consentVoiceAt
    ? new Date(profile.consentVoiceAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/voice-profile", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        title: "Stimmmodell gelöscht",
        description:
          "Modell und Aufnahmen wurden entfernt. Die personalisierte Begrüßung ist deaktiviert.",
        variant: "success",
      });
      setConfirmOpen(false);
      onDeleted();
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Bitte versuche es später erneut.",
        variant: "danger",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-squircle-sm bg-ok-soft text-ok">
              <Check className="size-5" strokeWidth={3} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink">
                  Deine KI-Stimme ist bereit
                </p>
                <Badge variant="brand">
                  <Sparkles className="size-3" />
                  KI
                </Badge>
              </div>
              <p className="text-sm text-ink-muted mt-1 leading-relaxed">
                Aktiviere jetzt in deinen Kampagnen die personalisierte
                Begrüßung, dann spricht jedes Video den Empfänger mit
                Vornamen an.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums">
                {sampleDate && <span>Stimmprobe vom {sampleDate}</span>}
                {profile.sampleDurationSec != null && (
                  <span>Länge {formatTime(profile.sampleDurationSec)} min</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-line-soft flex justify-end">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-danger transition-colors"
            >
              <Trash2 className="size-3.5" />
              Stimmmodell löschen
            </button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Stimmmodell löschen?</DialogTitle>
            <DialogDescription>
              Dein Stimmmodell und alle Aufnahmen werden dauerhaft gelöscht.
              Die personalisierte Begrüßung wird dadurch deaktiviert, deine
              Videos laufen dann wieder ohne persönliche Ansprache. Du kannst
              jederzeit eine neue Stimmprobe aufnehmen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              iconLeft={<Trash2 className="size-4" />}
              onClick={() => void handleDelete()}
            >
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Setup-Flow (Aufnahme → Einwilligung) ─────────────────────────────────

type SetupStep = "aufnahme" | "einwilligung";

function SetupFlow({
  onCancel,
  onSubmitted,
}: {
  onCancel: () => void;
  onSubmitted: (profile: VoiceProfileDto) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<SetupStep>("aufnahme");

  // Ergebnis von Aufnahme ODER Datei-Upload.
  const [sampleFile, setSampleFile] = React.useState<File | null>(null);
  const [sampleSource, setSampleSource] = React.useState<
    "aufnahme" | "upload" | null
  >(null);
  const [sampleSeconds, setSampleSeconds] = React.useState<number | null>(null);

  const [consentVoice, setConsentVoice] = React.useState(false);
  const [consentAi, setConsentAi] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit() {
    if (!sampleFile || !consentVoice || !consentAi) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", sampleFile);
      form.append("consentVoice", "true");
      form.append("consentAi", "true");
      const res = await fetch("/api/voice-profile/sample", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        profile?: VoiceProfileDto;
        error?: string;
      };
      if (!res.ok) {
        toast({
          title: "Upload fehlgeschlagen",
          description: body.error ?? "Bitte versuche es erneut.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Stimmprobe hochgeladen",
        description: "Das Training deiner KI-Stimme startet jetzt.",
        variant: "success",
      });
      onSubmitted(
        body.profile ?? {
          id: "pending",
          status: "processing",
          sampleUrl: null,
          sampleDurationSec: null,
          consentVoiceAt: new Date().toISOString(),
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      );
    } catch {
      toast({
        title: "Upload fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        <StepPill
          index={1}
          label="Aufnahme"
          active={step === "aufnahme"}
          done={step === "einwilligung"}
        />
        <span className="h-px w-6 bg-line" aria-hidden />
        <StepPill
          index={2}
          label="Einwilligung"
          active={step === "einwilligung"}
          done={false}
        />
      </div>

      {step === "aufnahme" ? (
        <RecordingStep
          sampleFile={sampleFile}
          sampleSource={sampleSource}
          sampleSeconds={sampleSeconds}
          onSample={(file, source, seconds) => {
            setSampleFile(file);
            setSampleSource(source);
            setSampleSeconds(seconds);
          }}
          onReset={() => {
            setSampleFile(null);
            setSampleSource(null);
            setSampleSeconds(null);
          }}
          onCancel={onCancel}
          onNext={() => setStep("einwilligung")}
        />
      ) : (
        <ConsentStep
          consentVoice={consentVoice}
          consentAi={consentAi}
          onConsentVoice={setConsentVoice}
          onConsentAi={setConsentAi}
          submitting={submitting}
          onBack={() => setStep("aufnahme")}
          onSubmit={() => void handleSubmit()}
        />
      )}
    </div>
  );
}

function StepPill({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold",
        active
          ? "bg-ink text-white"
          : done
            ? "bg-brand-soft text-brand-deep"
            : "bg-surface text-ink-muted shadow-card",
      )}
    >
      <span
        className={cn(
          "inline-flex w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-bold",
          active
            ? "bg-white/20 text-white"
            : done
              ? "bg-brand text-white"
              : "bg-surface-muted text-ink-muted",
        )}
      >
        {done ? <Check className="size-2.5" strokeWidth={3.5} /> : index}
      </span>
      {label}
    </span>
  );
}

// ── Schritt 1: Aufnahme ──────────────────────────────────────────────────

type RecState = "idle" | "recording" | "done";

function RecordingStep({
  sampleFile,
  sampleSource,
  sampleSeconds,
  onSample,
  onReset,
  onCancel,
  onNext,
}: {
  sampleFile: File | null;
  sampleSource: "aufnahme" | "upload" | null;
  sampleSeconds: number | null;
  onSample: (
    file: File,
    source: "aufnahme" | "upload",
    seconds: number | null,
  ) => void;
  onReset: () => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const [recState, setRecState] = React.useState<RecState>(
    sampleFile ? "done" : "idle",
  );
  const [elapsed, setElapsed] = React.useState(sampleSeconds ?? 0);
  const [micError, setMicError] = React.useState<string | null>(null);
  const [scriptOpen, setScriptOpen] = React.useState(false);
  const [playbackUrl, setPlaybackUrl] = React.useState<string | null>(null);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const mimeRef = React.useRef<string>("audio/webm");
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = React.useRef(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const stopAll = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    return () => {
      stopAll();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      recorderRef.current = null;
    };
  }, [stopAll]);

  // Blob-URL fürs Nachhören aufräumen.
  React.useEffect(() => {
    return () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  }, [playbackUrl]);

  async function startRecording() {
    setMicError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name =
        err instanceof Error && "name" in err ? (err as Error).name : "Error";
      setMicError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Zugriff auf das Mikrofon wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen."
          : "Kein Mikrofon gefunden oder Zugriff nicht möglich. Bitte prüfe dein Gerät.",
      );
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickAudioMime();
    mimeRef.current = mime;

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      stopAll();
      setMicError("Aufnahme nicht möglich. Bitte aktualisiere den Browser.");
      return;
    }
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stopAll();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      if (blob.size === 0) {
        setMicError("Die Aufnahme war leer. Bitte versuche es erneut.");
        setRecState("idle");
        setElapsed(0);
        return;
      }
      const ext = mimeRef.current.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `stimmprobe-${Date.now()}.${ext}`, {
        type: mimeRef.current,
      });
      const seconds = elapsedRef.current;
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(URL.createObjectURL(blob));
      setRecState("done");
      onSample(file, "aufnahme", seconds);
    };

    try {
      rec.start(1000);
    } catch {
      stopAll();
      setMicError("Aufnahme konnte nicht gestartet werden.");
      return;
    }
    recorderRef.current = rec;
    elapsedRef.current = 0;
    setElapsed(0);
    setRecState("recording");
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_SECONDS) {
        stopRecording();
      }
    }, 1000);
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try {
      r.requestData();
    } catch {
      /* ignore */
    }
    try {
      r.stop();
    } catch {
      /* ignore */
    }
  }

  function handleReRecord() {
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(null);
    }
    setElapsed(0);
    elapsedRef.current = 0;
    setRecState("idle");
    onReset();
  }

  function handleFileUpload(file: File | null) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: "Datei zu groß",
        description: "Die Datei darf höchstens 25 MB groß sein.",
        variant: "danger",
      });
      return;
    }
    const mime = file.type || "";
    if (!mime.startsWith("audio/") && !mime.startsWith("video/")) {
      toast({
        title: "Format nicht unterstützt",
        description: "Bitte wähle eine Audio- oder Videodatei.",
        variant: "danger",
      });
      return;
    }
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(null);
    }
    setRecState("done");
    onSample(file, "upload", null);
  }

  const tooShort =
    sampleSource === "aufnahme" &&
    sampleSeconds !== null &&
    sampleSeconds < MIN_SECONDS;
  const canContinue = sampleFile !== null && !tooShort;

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-ink">
            Nimm deine Stimmprobe auf
          </h3>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-muted">
            {[
              "Gleiches Mikrofon und gleiche Umgebung wie im Webcam-Video",
              "1 bis 2 Minuten frei sprechen oder den Text unten vorlesen",
              "Kleine Versprecher sind okay",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="size-4 text-brand-deep shrink-0 mt-0.5" />
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Vorlesetext, einklappbar */}
        <div className="rounded-squircle-sm bg-surface-soft overflow-hidden">
          <button
            type="button"
            onClick={() => setScriptOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink hover:bg-surface-muted/60 transition-colors"
            aria-expanded={scriptOpen}
          >
            <span className="inline-flex items-center gap-2">
              <BookOpenText className="size-4 text-brand-deep" />
              Vorlesetext anzeigen
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-ink-muted transition-transform",
                scriptOpen && "rotate-180",
              )}
            />
          </button>
          {scriptOpen && (
            <p className="px-4 pb-4 text-sm text-ink leading-7">
              {READING_SCRIPT}
            </p>
          )}
        </div>

        {micError && (
          <div className="flex items-start gap-2 rounded-squircle-sm bg-danger-soft px-4 py-3 text-sm text-danger">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            {micError}
          </div>
        )}

        {/* Recorder-Fläche */}
        {recState === "done" && sampleFile ? (
          <div className="rounded-squircle-sm bg-surface-soft p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-ok-soft text-ok shrink-0">
                <Check className="size-4" strokeWidth={3} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  {sampleSource === "upload"
                    ? sampleFile.name
                    : "Aufnahme fertig"}
                </p>
                <p className="text-xs text-ink-muted tabular-nums">
                  {sampleSource === "aufnahme" && sampleSeconds !== null
                    ? `Länge ${formatTime(sampleSeconds)} min`
                    : `${(sampleFile.size / (1024 * 1024)).toFixed(1)} MB`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<RotateCcw className="size-4" />}
                onClick={handleReRecord}
              >
                Neu aufnehmen
              </Button>
            </div>
            {playbackUrl && (
              <audio
                src={playbackUrl}
                controls
                className="mt-3 w-full h-10"
                preload="metadata"
              />
            )}
            {tooShort && (
              <p className="mt-3 text-xs text-danger">
                Die Aufnahme ist zu kurz, bitte sprich mindestens 30 Sekunden.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-squircle-sm bg-surface-soft p-5">
            <div className="flex flex-col items-center gap-4">
              {recState === "recording" ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="relative flex size-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
                      <span className="relative inline-flex size-3 rounded-full bg-danger" />
                    </span>
                    <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                      {formatTime(elapsed)}
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums">
                      / max. {formatTime(MAX_SECONDS)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs tabular-nums",
                      elapsed < MIN_SECONDS
                        ? "text-ink-muted"
                        : "text-ok font-medium",
                    )}
                  >
                    {elapsed < MIN_SECONDS
                      ? `Noch mindestens ${formatTime(MIN_SECONDS - elapsed)} min sprechen`
                      : "Länge reicht aus, du kannst jederzeit beenden"}
                  </p>
                  <Button
                    variant="danger"
                    iconLeft={<Square className="size-4 fill-current" />}
                    onClick={stopRecording}
                  >
                    Aufnahme beenden
                  </Button>
                </>
              ) : (
                <>
                  <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                    <Mic className="size-6" />
                  </span>
                  <p className="text-xs text-ink-muted text-center max-w-xs leading-relaxed">
                    Mindestens 0:30, maximal 4:00 Minuten. Dein Browser fragt
                    einmalig nach Mikrofon-Zugriff.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      iconLeft={<Circle className="size-4 fill-current" />}
                      onClick={() => void startRecording()}
                    >
                      Aufnahme starten
                    </Button>
                    <Button
                      variant="ghost"
                      iconLeft={<Upload className="size-4" />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Datei hochladen
                    </Button>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    Alternativ: Audio- oder Videodatei, max. 25 MB
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                handleFileUpload(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            disabled={!canContinue}
            iconRight={<ArrowRight className="size-4" />}
            onClick={onNext}
          >
            Weiter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Schritt 2: Einwilligung ──────────────────────────────────────────────

function ConsentStep({
  consentVoice,
  consentAi,
  onConsentVoice,
  onConsentAi,
  submitting,
  onBack,
  onSubmit,
}: {
  consentVoice: boolean;
  consentAi: boolean;
  onConsentVoice: (v: boolean) => void;
  onConsentAi: (v: boolean) => void;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-ink">
              Deine Einwilligung
            </h3>
            <p className="text-sm text-ink-muted mt-0.5 leading-relaxed">
              Deine Stimme gehört dir. Deshalb brauchen wir beide Häkchen,
              bevor das Training startet.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-squircle-sm bg-surface-soft p-4 cursor-pointer">
          <Checkbox
            checked={consentVoice}
            onCheckedChange={(v) => onConsentVoice(v === true)}
            className="mt-0.5"
            aria-label="Einwilligung Stimmmodell"
          />
          <span className="text-xs text-ink leading-relaxed">
            {CONSENT_VOICE_TEXT}
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-squircle-sm bg-surface-soft p-4 cursor-pointer">
          <Checkbox
            checked={consentAi}
            onCheckedChange={(v) => onConsentAi(v === true)}
            className="mt-0.5"
            aria-label="Einwilligung KI-Generierung"
          />
          <span className="text-xs text-ink leading-relaxed">
            {CONSENT_AI_TEXT}
          </span>
        </label>

        <p className="text-xs text-ink-muted">
          Du bestätigst, dass die Aufnahme ausschließlich deine eigene Stimme
          enthält.
        </p>

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={submitting}
            iconLeft={<ArrowLeft className="size-4" />}
          >
            Zurück
          </Button>
          <Button
            disabled={!consentVoice || !consentAi}
            loading={submitting}
            iconLeft={<Sparkles className="size-4" />}
            onClick={onSubmit}
          >
            KI-Stimme erstellen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
