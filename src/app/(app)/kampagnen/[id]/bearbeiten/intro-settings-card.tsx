"use client";

/**
 * Kampagnen-Karte "Personalisierte Begrüßung" (Intro-Feature).
 *
 * Voraussetzungs-Kette, jede Stufe mit genau EINER Aktion:
 *   1. Kein Webcam-Video          → Hinweis (Aktion liegt in der Webcam-Karte)
 *   2. Einwilligung fehlt         → Checkboxen + Button (Stimme kommt aus dem Video)
 *   3. Video nicht kalibriert     → Button "Video analysieren" + Polling
 *   4. Alles bereit               → Toggle + Begrüßungs-Vorlage editierbar
 *
 * Ein Wechsel des Kampagnen-Webcam-Videos triggert automatisch einen
 * Re-Check der Kalibrierung (Effect auf `webcamMediaId`).
 */

import * as React from "react";
import {
  AlertCircle,
  Check,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RecordingHint } from "@/components/intro/recording-hint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toaster";
import {
  CONSENT_AI_TEXT,
  CONSENT_VOICE_TEXT,
  DEFAULT_TTS_TEMPLATE,
  GREETING_PREFIXES,
  type GreetingPrefix,
  type NamePatternKey,
  buildGreetingTemplate,
  parseGreetingTemplate,
} from "@/lib/intro";
import { calibrationErrorHint } from "@/lib/intro-calibration-hints";
import { cn } from "@/lib/utils";

const DEFAULT_PICK = parseGreetingTemplate(DEFAULT_TTS_TEMPLATE) ?? {
  prefix: "Hi" as GreetingPrefix,
  pattern: "firstName" as NamePatternKey,
};

// ── API-Verträge ─────────────────────────────────────────────────────────

interface VoiceProfileDto {
  id: string;
  status: "pending_sample" | "processing" | "ready" | "failed";
  consentVoiceAt: string | null;
  consentAiAt: string | null;
}

interface CalibrationDto {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
  transcriptSentence: string | null;
  ttsTemplate: string | null;
  error: string | null;
}

function errorHint(code: string | null): string {
  return (
    calibrationErrorHint(code) ??
    "Die Analyse ist fehlgeschlagen. Bitte versuche es erneut oder nimm das Video neu auf."
  );
}

export function IntroSettingsCard({
  campaignId,
  webcamMediaId,
  initialEnabled,
}: {
  campaignId: string;
  webcamMediaId: string | null;
  initialEnabled: boolean;
}) {
  const { toast } = useToast();

  // "ready" = Einwilligungen liegen vor (oder Legacy-Konto-Stimme existiert).
  // Die eigentliche Stimme wird pro Video bei der Kalibrierung trainiert.
  const [voiceStatus, setVoiceStatus] = React.useState<
    "loading" | "none" | "ready"
  >("loading");
  const [consentVoice, setConsentVoice] = React.useState(false);
  const [consentAi, setConsentAi] = React.useState(false);
  const [consentSaving, setConsentSaving] = React.useState(false);
  const [calibration, setCalibration] = React.useState<CalibrationDto | null>(
    null,
  );
  const [calibrationLoading, setCalibrationLoading] = React.useState(false);
  // true, sobald der erste GET der Kalibrierung abgeschlossen ist — erst
  // dann darf der Auto-Start entscheiden, ob eine Analyse fehlt.
  const [calibrationChecked, setCalibrationChecked] = React.useState(false);
  const [analyzeStarting, setAnalyzeStarting] = React.useState(false);
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [toggleSaving, setToggleSaving] = React.useState(false);

  // Begrüßung: Prefix + Namensart. Wird beim Speichern zu einem
  // `{prefix} {vorname}`- / `{prefix} {anrede} {nachname}`-Template
  // zusammengesetzt und in intro_calibrations.tts_template abgelegt.
  const [prefix, setPrefix] = React.useState<GreetingPrefix>(DEFAULT_PICK.prefix);
  const [pattern, setPattern] = React.useState<NamePatternKey>(DEFAULT_PICK.pattern);
  const [greetingSaving, setGreetingSaving] = React.useState(false);
  const [greetingDirty, setGreetingDirty] = React.useState(false);

  // ── KI-Stimme laden ─────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice-profile", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { profile: VoiceProfileDto | null };
        if (cancelled) return;
        const p = data.profile;
        const consented = Boolean(p?.consentVoiceAt && p?.consentAiAt);
        setVoiceStatus(
          consented || p?.status === "ready" || p?.status === "processing"
            ? "ready"
            : "none",
        );
      } catch {
        if (!cancelled) setVoiceStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Kalibrierung laden (re-check bei Webcam-Wechsel) ────────────────
  const loadCalibration = React.useCallback(async () => {
    if (!webcamMediaId) {
      setCalibration(null);
      return;
    }
    setCalibrationLoading(true);
    try {
      const res = await fetch(
        `/api/media/${webcamMediaId}/intro-calibration`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { calibration: CalibrationDto | null };
      setCalibration(data.calibration);
      if (data.calibration?.ttsTemplate && !greetingDirty) {
        const parsed = parseGreetingTemplate(data.calibration.ttsTemplate);
        if (parsed) {
          setPrefix(parsed.prefix);
          setPattern(parsed.pattern);
        }
      }
    } catch {
      setCalibration(null);
    } finally {
      setCalibrationLoading(false);
      setCalibrationChecked(true);
    }
    // greetingDirty bewusst nicht in den Deps — der User-Edit soll beim
    // Polling nicht überschrieben werden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamMediaId]);

  React.useEffect(() => {
    // Webcam gewechselt → Vorlage-Editing zurücksetzen und neu laden.
    setGreetingDirty(false);
    setPrefix(DEFAULT_PICK.prefix);
    setPattern(DEFAULT_PICK.pattern);
    void loadCalibration();
  }, [loadCalibration]);

  // Polling alle 5s solange die Analyse läuft.
  const calibrationRunning =
    calibration?.status === "pending" || calibration?.status === "running";
  React.useEffect(() => {
    if (!calibrationRunning) return;
    const handle = window.setInterval(() => {
      void loadCalibration();
    }, 5000);
    return () => window.clearInterval(handle);
  }, [calibrationRunning, loadCalibration]);

  // Ältere Videos ohne Kalibrierung: Analyse automatisch anstoßen, damit
  // der User nichts klicken muss (neue Uploads starten sie schon beim
  // Upload). Ref-Guard: höchstens 1× pro Video.
  const autoStartedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (
      !webcamMediaId ||
      !calibrationChecked ||
      calibrationLoading ||
      calibration !== null ||
      autoStartedRef.current === webcamMediaId
    ) {
      return;
    }
    autoStartedRef.current = webcamMediaId;
    void startAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamMediaId, calibrationChecked, calibrationLoading, calibration]);

  // ── Aktionen ────────────────────────────────────────────────────────
  async function startAnalysis() {
    if (!webcamMediaId) return;
    setAnalyzeStarting(true);
    try {
      const res = await fetch(
        `/api/media/${webcamMediaId}/intro-calibration`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        calibration?: CalibrationDto;
        error?: string;
      };
      if (!res.ok) {
        toast({
          title: "Analyse konnte nicht gestartet werden",
          description: body.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      setCalibration(body.calibration ?? null);
    } catch {
      toast({
        title: "Analyse konnte nicht gestartet werden",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setAnalyzeStarting(false);
    }
  }

  async function saveConsent() {
    setConsentSaving(true);
    try {
      const res = await fetch("/api/voice-profile/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentVoice: true, consentAi: true }),
      });
      if (!res.ok) throw new Error();
      setVoiceStatus("ready");
      // Eine wegen fehlender Einwilligung fehlgeschlagene Kalibrierung
      // direkt neu anstoßen — sonst müsste der User zweimal klicken.
      if (calibration?.status === "failed") void startAnalysis();
      toast({
        title: "Einwilligung gespeichert",
        description: "Deine KI-Stimme kommt automatisch aus deinem Video.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Bitte erneut versuchen.",
        variant: "danger",
      });
    } finally {
      setConsentSaving(false);
    }
  }

  async function saveToggle(next: boolean) {
    setEnabled(next);
    setToggleSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ introEnabled: next }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: "Gespeichert",
        description: next
          ? "Personalisierte Begrüßung ist aktiv."
          : "Personalisierte Begrüßung ist deaktiviert.",
        variant: "success",
      });
    } catch {
      setEnabled(!next);
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Bitte erneut versuchen.",
        variant: "danger",
      });
    } finally {
      setToggleSaving(false);
    }
  }

  const templateString = buildGreetingTemplate(prefix, pattern);

  const saveGreeting = React.useCallback(
    async (nextPrefix: GreetingPrefix, nextPattern: NamePatternKey) => {
      if (!webcamMediaId) return;
      setGreetingSaving(true);
      try {
        const res = await fetch(
          `/api/media/${webcamMediaId}/intro-calibration`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ttsTemplate: buildGreetingTemplate(nextPrefix, nextPattern),
            }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          calibration?: CalibrationDto;
          error?: string;
        };
        if (!res.ok) {
          toast({
            title: "Speichern fehlgeschlagen",
            description: body.error ?? "Bitte erneut versuchen.",
            variant: "danger",
          });
          return;
        }
        if (body.calibration) setCalibration(body.calibration);
      } catch {
        toast({
          title: "Speichern fehlgeschlagen",
          description: "Verbindung zum Server fehlgeschlagen.",
          variant: "danger",
        });
      } finally {
        setGreetingSaving(false);
      }
    },
    [webcamMediaId, toast],
  );

  // Preview-Beispiel: informell zeigt Vorname, formal zeigt Herr/Frau.
  const previewLine =
    pattern === "firstName"
      ? templateString.replaceAll("{vorname}", "Jürgen")
      : templateString
          .replaceAll("{anrede}", "Herr")
          .replaceAll("{nachname}", "Thiesen");

  const ready =
    voiceStatus === "ready" && calibration?.status === "ready";

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Personalisierte Begrüßung</CardTitle>
          <Badge variant="brand">
            <Sparkles className="size-3" />
            KI
          </Badge>
          <Badge variant="neutral">2 Credits pro Video</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-ink-muted leading-relaxed">
            Der erste Satz deines Videos wird pro Lead mit Vornamen
            gesprochen, in deiner Stimme und mit passenden Lippenbewegungen.
            <span className="block text-xs mt-1">
              Bei nicht nutzbarem Vornamen automatisch Original-Video, 1
              Credit.
            </span>
          </p>
          <Switch
            checked={enabled}
            // Deaktivieren muss immer möglich sein — nur das Aktivieren
            // setzt fertige Stimme + Kalibrierung voraus.
            disabled={toggleSaving || (!ready && !enabled)}
            onCheckedChange={(v) => void saveToggle(v)}
            aria-label="Personalisierte Begrüßung aktivieren"
          />
        </div>

        {enabled && <RecordingHint />}

        {enabled && (
          <p className="flex items-start gap-2 text-xs text-ink-muted leading-relaxed">
            <Check className="size-3.5 shrink-0 mt-0.5 text-ok" />
            Vor jeder Vollproduktion bekommst du eine Testrunde mit 3
            Beispielvideos zur Freigabe. Erst nach deiner Bestätigung werden
            alle Videos erzeugt.
          </p>
        )}

        {/* Voraussetzungs-Stufen */}
        {voiceStatus === "loading" || (calibrationLoading && !calibration) ? (
          <div className="flex items-center gap-2 rounded-squircle-sm bg-surface-soft px-4 py-3 text-sm text-ink-muted">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Status wird geprüft ...
          </div>
        ) : !webcamMediaId ? (
          <PrereqHint text="Wähle zuerst oben ein Webcam-Video für diese Kampagne." />
        ) : voiceStatus === "none" ? (
          <div className="rounded-squircle-sm bg-surface-soft px-4 py-3 space-y-3">
            <p className="text-sm text-ink leading-relaxed">
              Deine KI-Stimme kommt automatisch aus deinem Kampagnen-Video —
              du musst nichts aufnehmen. Wir brauchen nur einmalig deine
              Einwilligung:
            </p>
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
            <Button
              size="sm"
              disabled={!consentVoice || !consentAi}
              loading={consentSaving}
              onClick={() => void saveConsent()}
            >
              Einwilligen &amp; Stimme aus dem Video verwenden
            </Button>
          </div>
        ) : !calibration || calibration.status === "failed" ? (
          <div className="rounded-squircle-sm bg-surface-soft px-4 py-3 space-y-3">
            {calibration?.status === "failed" && (
              <div className="space-y-1.5">
                <p className="flex items-start gap-2 text-sm text-danger">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  {errorHint(calibration.error)}
                </p>
                {calibration.transcriptSentence && (
                  <p className="pl-6 text-xs text-ink-muted leading-relaxed">
                    Gehört haben wir:{" "}
                    <span className="italic">
                      &bdquo;{calibration.transcriptSentence}&ldquo;
                    </span>
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                {calibration?.status === "failed"
                  ? "Du kannst die Analyse erneut starten."
                  : "Wir analysieren einmalig den ersten Satz deines Videos."}
              </p>
              <Button
                variant="subtle"
                size="sm"
                loading={analyzeStarting}
                iconLeft={<ScanLine className="size-4" />}
                onClick={() => void startAnalysis()}
              >
                {calibration?.status === "failed"
                  ? "Erneut analysieren"
                  : "Video analysieren"}
              </Button>
            </div>
          </div>
        ) : calibrationRunning ? (
          <div className="flex items-center gap-3 rounded-squircle-sm bg-brand-soft px-4 py-3 text-sm text-brand-deep">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Video wird analysiert, das dauert etwa eine Minute ...
          </div>
        ) : (
          <div className="space-y-4 pt-1 border-t border-line-soft">
            {calibration.transcriptSentence && (
              <div className="pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                  Erkannter erster Satz
                </p>
                <p className="flex items-start gap-2 text-sm text-ink leading-relaxed">
                  <Check className="size-4 text-ok shrink-0 mt-0.5" />
                  <span className="italic">
                    &bdquo;{calibration.transcriptSentence}&ldquo;
                  </span>
                </p>
              </div>
            )}

            <div className={cn(!calibration.transcriptSentence && "pt-3")}>
              <Label>Begrüßung</Label>
              <p className="mt-1 mb-2 text-xs text-ink-muted leading-relaxed">
                Wähle Anrede und Namensart. Die TTS spricht nur diese kurze
                Zeile — der Rest deines Videos läuft danach unverändert
                weiter. Passe sie so an, dass sie zum Ton deiner
                Original-Aufnahme passt.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="intro-prefix"
                    className="text-xs font-medium text-ink-muted"
                  >
                    Anrede
                  </Label>
                  <Select
                    value={prefix}
                    onValueChange={(v) => {
                      const next = v as GreetingPrefix;
                      setPrefix(next);
                      setGreetingDirty(true);
                      void saveGreeting(next, pattern);
                    }}
                  >
                    <SelectTrigger id="intro-prefix" className="mt-1">
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
                  <Label
                    htmlFor="intro-pattern"
                    className="text-xs font-medium text-ink-muted"
                  >
                    Namensart
                  </Label>
                  <Select
                    value={pattern}
                    onValueChange={(v) => {
                      const next = v as NamePatternKey;
                      setPattern(next);
                      setGreetingDirty(true);
                      void saveGreeting(prefix, next);
                    }}
                  >
                    <SelectTrigger id="intro-pattern" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="firstName">Vorname (Du)</SelectItem>
                      <SelectItem value="formal">
                        Herr/Frau + Nachname (Sie)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Beispiel:{" "}
                <span className="font-medium text-ink">„{previewLine}"</span>
                {greetingSaving && (
                  <span className="ml-2 text-ink-soft">Speichere ...</span>
                )}
              </p>
              {pattern === "formal" && (
                <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                  Braucht die Spalten <span className="font-mono">Anrede</span>{" "}
                  (Herr/Frau) und{" "}
                  <span className="font-mono">Nachname</span> in deiner
                  Leadliste. Fehlt eines, greift automatisch der
                  Original-Video-Fallback (1 Credit).
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PrereqHint({
  text,
  action,
}: {
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-squircle-sm bg-surface-soft px-4 py-3">
      <p className="text-sm text-ink-muted">{text}</p>
      {action}
    </div>
  );
}
