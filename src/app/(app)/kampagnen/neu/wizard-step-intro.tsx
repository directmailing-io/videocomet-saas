"use client";

import * as React from "react";
import { Check, Info, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecordingHint } from "@/components/intro/recording-hint";
import { VoiceExtraRecorder } from "@/components/intro/voice-extra-recorder";
import {
  CONSENT_AI_TEXT,
  CONSENT_VOICE_TEXT,
  GREETING_PREFIXES,
  VOICE_VIDEO_OK_SECONDS,
  buildGreetingTemplate,
  type GreetingPrefix,
  type NamePatternKey,
} from "@/lib/intro";
import { cn } from "@/lib/utils";

export interface WizardStepIntroProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Gewähltes Video aus Schritt 1 — Quelle für die KI-Stimme. */
  webcamMediaId: string | null;
  /** Länge des gewählten Videos (Sekunden) — entscheidet, ob eine Zusatz-Sprachprobe nötig ist. */
  webcamDurationSec: number | null;
  greetingPrefix: GreetingPrefix;
  namePattern: NamePatternKey;
  onGreetingChange: (prefix: GreetingPrefix, pattern: NamePatternKey) => void;
  /** true = „Weiter" blockieren, bis die Stimmquelle geklärt ist. */
  onVoiceGateChange: (blocked: boolean) => void;
}

interface VoiceProfileResponse {
  profile: {
    consentVoiceAt: string | null;
    consentAiAt: string | null;
  } | null;
  calibrations: Array<{
    mediaItemId: string;
    extraAudioUrl: string | null;
  }>;
}

/** Mini-Mockup: Vollbild-Video ohne Personalisierung. */
function VisualPlain() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
      <div className="absolute left-1/2 top-[30%] size-[22%] -translate-x-1/2 rounded-full bg-white/30" />
      <div className="absolute left-1/2 top-[58%] h-[55%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/30" />
    </div>
  );
}

/** Mini-Mockup: gleiche Bühne, aber mit „Hi Jürgen!"-Sprechblase. */
function VisualPersonalized() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
      <div className="absolute left-1/2 top-[30%] size-[22%] -translate-x-1/2 rounded-full bg-white/30" />
      <div className="absolute left-1/2 top-[58%] h-[55%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/30" />
      <div className="absolute right-[8%] top-[14%] rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-white shadow-card">
        „Hi Jürgen!"
      </div>
    </div>
  );
}

function fmtMin(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Wizard-Schritt "KI-Begrüßung" — Opt-in für die personalisierte
 * Video-Begrüßung direkt bei der Kampagnen-Erstellung.
 *
 * Die KI-Stimme kommt IMMER aus der Tonspur des gewählten Videos
 * (per-Video-Training in der Kalibrierung). Ist das Video kürzer als
 * VOICE_VIDEO_OK_SECONDS, muss der User hier eine Zusatz-Sprachprobe
 * aufnehmen — beide zusammen ergeben das Trainings-Material. „Weiter"
 * ist so lange blockiert (onVoiceGateChange), bis die Stimmquelle steht.
 */
export function WizardStepIntro({
  enabled,
  onChange,
  webcamMediaId,
  webcamDurationSec,
  greetingPrefix,
  namePattern,
  onGreetingChange,
  onVoiceGateChange,
}: WizardStepIntroProps) {
  const [loaded, setLoaded] = React.useState(false);
  const [consentStored, setConsentStored] = React.useState(false);
  const [extraDone, setExtraDone] = React.useState(false);
  const [consentVoice, setConsentVoice] = React.useState(false);
  const [consentAi, setConsentAi] = React.useState(false);
  const [consentSaving, setConsentSaving] = React.useState(false);
  const [consentError, setConsentError] = React.useState<string | null>(null);

  // Zusatz-Sprachprobe nötig? Unbekannte Länge behandeln wir wie „lang
  // genug" — das Quality-Gate im Worker fängt Extremfälle ab.
  const needExtra =
    webcamDurationSec !== null && webcamDurationSec < VOICE_VIDEO_OK_SECONDS;
  const consentOk = consentStored || (consentVoice && consentAi);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice-profile", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as VoiceProfileResponse;
        if (cancelled) return;
        setConsentStored(
          Boolean(data.profile?.consentVoiceAt && data.profile?.consentAiAt),
        );
        if (webcamMediaId) {
          setExtraDone(
            data.calibrations.some(
              (c) => c.mediaItemId === webcamMediaId && c.extraAudioUrl,
            ),
          );
        }
      } catch {
        // still bleiben — Gate blockiert dann höchstens unnötig streng
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webcamMediaId]);

  // Gate an den Container melden: blockiert, solange die Einwilligung
  // nicht GESPEICHERT ist bzw. (bei kurzem Video) die Zusatz-Aufnahme
  // aussteht. Der Upload der Aufnahme speichert die Einwilligung mit.
  const blocked =
    enabled && loaded && (needExtra ? !extraDone : !consentStored);
  React.useEffect(() => {
    onVoiceGateChange(blocked);
  }, [blocked, onVoiceGateChange]);

  async function saveConsent() {
    setConsentSaving(true);
    setConsentError(null);
    try {
      const res = await fetch("/api/voice-profile/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentVoice: true, consentAi: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Speichern fehlgeschlagen.");
      }
      setConsentStored(true);
    } catch (err) {
      setConsentError(
        err instanceof Error && err.message
          ? err.message
          : "Speichern fehlgeschlagen. Bitte erneut versuchen.",
      );
    } finally {
      setConsentSaving(false);
    }
  }

  async function uploadExtraAudio(blob: Blob) {
    if (!webcamMediaId) throw new Error("Kein Video gewählt.");
    const form = new FormData();
    form.set(
      "file",
      new File([blob], "sprachprobe.webm", {
        type: blob.type || "audio/webm",
      }),
    );
    form.set("mediaItemId", webcamMediaId);
    form.set("consentVoice", "true");
    form.set("consentAi", "true");
    const res = await fetch("/api/voice-profile/extra-audio", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(data?.error ?? "Upload fehlgeschlagen.");
    }
    setExtraDone(true);
    setConsentStored(true);
  }

  const options = [
    {
      value: false,
      title: "Ohne KI-Begrüßung",
      description: "Alle Leads sehen dein Video so, wie du es aufgenommen hast.",
      costHint: "1 Credit pro Video",
      visual: <VisualPlain />,
    },
    {
      value: true,
      title: "Mit persönlicher KI-Begrüßung",
      description:
        "Der erste Satz wird pro Lead mit Vornamen gesprochen, in deiner Stimme und mit passenden Lippenbewegungen.",
      costHint: "2 Credits pro Video",
      visual: <VisualPersonalized />,
    },
  ] as const;

  const consentCheckboxes = !consentStored && (
    <div className="space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <Checkbox
          checked={consentVoice}
          onCheckedChange={(v) => setConsentVoice(v === true)}
          className="mt-0.5"
          aria-label="Einwilligung Stimm-Klonen"
        />
        <span className="text-xs text-ink leading-relaxed">
          {CONSENT_VOICE_TEXT}
        </span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <Checkbox
          checked={consentAi}
          onCheckedChange={(v) => setConsentAi(v === true)}
          className="mt-0.5"
          aria-label="Einwilligung KI-Generierung"
        />
        <span className="text-xs text-ink leading-relaxed">
          {CONSENT_AI_TEXT}
        </span>
      </label>
      <p className="text-xs text-ink-muted">
        Du bestätigst, dass Video und Aufnahme ausschließlich deine eigene
        Stimme enthalten.
      </p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {options.map((opt) => {
          const active = opt.value === enabled;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={cn(
                "relative flex flex-col text-left rounded-squircle-lg bg-surface shadow-card p-6 transition-all duration-200 ease-spring",
                active
                  ? "ring-2 ring-brand"
                  : "hover:shadow-card-hover hover:-translate-y-0.5",
              )}
            >
              {active && (
                <span className="absolute top-4 right-4 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                  <Check className="size-3.5" />
                </span>
              )}
              <div className="mb-5">{opt.visual}</div>
              <span className="flex items-center gap-2 text-base font-semibold text-ink mb-1.5">
                {opt.value && <Sparkles className="size-4 text-brand" />}
                {opt.title}
              </span>
              <span className="text-sm text-ink-muted leading-relaxed">
                {opt.description}
              </span>
              <span className="mt-auto pt-4 text-xs font-medium text-ink-soft">
                {opt.costHint}
              </span>
            </button>
          );
        })}
      </div>

      {enabled && (
        <div className="rounded-squircle-lg bg-surface shadow-card p-5 space-y-4">
          <GreetingChooser
            prefix={greetingPrefix}
            pattern={namePattern}
            onChange={onGreetingChange}
          />
          <div className="space-y-2">
            <p className="flex items-start gap-2.5 text-sm text-ink-muted leading-relaxed">
              <Info className="size-4 shrink-0 mt-0.5 text-ink-soft" />
              <span>
                <strong className="text-ink">
                  Dein Video ist schon aufgenommen?
                </strong>{" "}
                Prüfe kurz, ob der Anfang zu den Beispielen unten passt. Falls
                nicht, geh einfach einen Schritt zurück und nimm es neu auf.
              </span>
            </p>
            <RecordingHint compact />
          </div>
          <p className="flex items-start gap-2.5 text-sm text-ink-muted leading-relaxed">
            <Info className="size-4 shrink-0 mt-0.5 text-ink-soft" />
            <span>
              Die KI-Begrüßung kostet <strong className="text-ink">2 Credits pro Video</strong>{" "}
              statt 1. Das Ergebnis ist KI-generiert und kann in Einzelfällen
              vom Original abweichen, eine perfekte Begrüßung ist nicht
              garantiert. Bei nicht nutzbarem Vornamen wird automatisch dein
              Original-Video verwendet und nur 1 Credit berechnet.
            </span>
          </p>
          <p className="flex items-start gap-2.5 text-sm text-ink-muted leading-relaxed">
            <Check className="size-4 shrink-0 mt-0.5 text-ok" />
            <span>
              Vor jeder Vollproduktion bekommst du eine{" "}
              <strong className="text-ink">Testrunde mit 3 Beispielvideos</strong>{" "}
              zur Freigabe. Erst wenn du die Qualität bestätigst, werden alle
              Videos erzeugt.
            </span>
          </p>

          {/* ── Stimmquelle ─────────────────────────────────────────── */}
          {!loaded ? (
            <div className="flex items-center gap-2 rounded-squircle-sm bg-surface-soft px-4 py-3 text-sm text-ink-muted">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Stimm-Status wird geprüft ...
            </div>
          ) : !needExtra ? (
            // Video ist lang genug — Stimme kommt komplett aus dem Video.
            <div className="rounded-squircle-sm bg-surface-soft px-4 py-4 space-y-3">
              <p className="flex items-start gap-2.5 text-sm text-ink leading-relaxed">
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    consentStored ? "bg-ok" : "bg-brand",
                  )}
                >
                  {consentStored ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Mic className="size-3.5" />
                  )}
                </span>
                <span>
                  <strong>
                    Deine KI-Stimme kommt direkt aus deinem Video
                  </strong>
                  {webcamDurationSec !== null && (
                    <> ({fmtMin(webcamDurationSec)} Min. Ton — das reicht)</>
                  )}
                  . Gleiches Mikrofon, gleicher Raum, genau deine Sprechweise.
                  {consentStored
                    ? " Du musst nichts weiter tun."
                    : " Bestätige nur noch die Einwilligungen unten."}
                </span>
              </p>
              {consentCheckboxes}
              {!consentStored && (
                <>
                  {consentError && (
                    <p className="text-sm text-danger leading-relaxed">
                      {consentError}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={!consentVoice || !consentAi}
                    loading={consentSaving}
                    iconLeft={<Sparkles className="size-4" />}
                    onClick={() => void saveConsent()}
                  >
                    Einwilligen &amp; Stimme aus dem Video verwenden
                  </Button>
                </>
              )}
            </div>
          ) : extraDone ? (
            <div className="flex items-center gap-3 rounded-squircle-sm bg-ok-soft px-4 py-3.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                <Check className="size-5" />
              </span>
              <p className="text-sm text-ink leading-relaxed">
                <strong>Stimmquelle steht:</strong> dein Video plus deine
                Sprachprobe. Das Training läuft automatisch im Hintergrund.
              </p>
            </div>
          ) : (
            <div className="rounded-squircle-sm bg-surface-soft px-4 py-4 space-y-4">
              <p className="flex items-start gap-2.5 text-sm text-ink leading-relaxed">
                <Mic className="size-4 shrink-0 mt-0.5 text-brand" />
                <span>
                  <strong>
                    Dein Video ist mit {fmtMin(webcamDurationSec ?? 0)} Min.
                    zu kurz für eine perfekte KI-Stimme.
                  </strong>{" "}
                  Sprich hier noch kurz frei ins Mikrofon — wir kombinieren
                  Video und Aufnahme, damit deine Stimme wirklich nach dir
                  klingt.
                </span>
              </p>
              {consentCheckboxes}
              <VoiceExtraRecorder
                videoDurationSec={webcamDurationSec ?? 0}
                canRecord={consentOk}
                onUpload={uploadExtraAudio}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prefix + Namensart-Auswahl (identisch zur intro-settings-card in der
 *  Bearbeiten-Ansicht). Wird beim Save an /api/campaigns übergeben. */
function GreetingChooser({
  prefix,
  pattern,
  onChange,
}: {
  prefix: GreetingPrefix;
  pattern: NamePatternKey;
  onChange: (prefix: GreetingPrefix, pattern: NamePatternKey) => void;
}) {
  const template = buildGreetingTemplate(prefix, pattern);
  const preview =
    pattern === "firstName"
      ? template.replaceAll("{vorname}", "Julius")
      : template.replaceAll("{anrede}", "Herr").replaceAll("{nachname}", "Thiesen");
  return (
    <div className="rounded-squircle-md border border-line bg-surface-soft p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink">Begrüßung wählen</p>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
          So spricht die KI-Stimme jeden Lead an. Kurz und persönlich —
          der Rest deines Videos folgt unverändert.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="wiz-intro-prefix" className="text-xs font-medium text-ink-muted">
            Anrede
          </Label>
          <Select
            value={prefix}
            onValueChange={(v) => onChange(v as GreetingPrefix, pattern)}
          >
            <SelectTrigger id="wiz-intro-prefix" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GREETING_PREFIXES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="wiz-intro-pattern" className="text-xs font-medium text-ink-muted">
            Namensart
          </Label>
          <Select
            value={pattern}
            onValueChange={(v) => onChange(prefix, v as NamePatternKey)}
          >
            <SelectTrigger id="wiz-intro-pattern" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="firstName">Vorname (Du)</SelectItem>
              <SelectItem value="formal">Herr/Frau + Nachname (Sie)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Beispiel: <span className="font-medium text-ink">„{preview}"</span>
      </p>
      {pattern === "formal" && (
        <p className="text-xs text-ink-muted leading-relaxed">
          Braucht die Spalten <span className="font-mono">Anrede</span>{" "}
          (Herr/Frau) und <span className="font-mono">Nachname</span> in deiner
          Leadliste. Fehlt eines, greift automatisch der Original-Video-Fallback
          (1 Credit).
        </p>
      )}
    </div>
  );
}
