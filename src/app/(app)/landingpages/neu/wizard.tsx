"use client";

/**
 * Einstiegs-Wizard für neue Landingpage-Vorlagen (Konzept v3, Abschnitt 2
 * + 3.3/3.4): EIN Schritt vor dem Builder.
 *
 *   Weg A — „Wie meine Website": URL-Analyse (Polling, 30 s Timeout) mit
 *           Fortschritts-Feedback, danach Bestätigungs-Screen (EINE Karte).
 *   Weg B — „Eigenen Look wählen": manueller Styleguide-Schritt.
 *   Weg C — „Meinen gespeicherten Look verwenden": nur sichtbar, wenn ein
 *           Account-Standard existiert; springt direkt zum Bestätigen.
 *
 * Abschluss: fremde Logos werden via /api/brand/logo-import auf unser CDN
 * kopiert, optional wird das Kit als Account-Standard gespeichert, dann
 * legt POST /api/landing-page-templates die Vorlage mit vorbefüllter
 * Starter-Seite (buildStarterBlocks) im Markenlook an → Redirect in den
 * Editor. Kein Dead-End: jeder Fehler bietet den manuellen Weg an.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  brandKitToTheme,
  type BrandKit,
} from "@/lib/landing-theme/brand-kit";
import { getFontPair } from "@/lib/landing-theme/font-pairs";
import { buildStarterBlocks } from "@/lib/landing-blocks/starter-page";
import { cn } from "@/lib/utils";
import {
  importLogo,
  runBrandExtraction,
  type ExtractionPhase,
  type LogoCandidate,
} from "../_styleguide/extract-client";
import {
  BrandKitGroups,
  type BrandKitChangeMeta,
} from "../_styleguide/kit-fields";
import {
  RADIUS_LABELS,
  SHADOW_LABELS,
  makeDefaultKit,
} from "../_styleguide/kit-labels";
import { MiniHeroPreview } from "../_styleguide/mini-preview";

type Step = "choice" | "analyzing" | "confirm" | "manual";

/** Woher stammt das aktuell gewählte Logo? Externe Quellen werden beim
 *  Anlegen via /api/brand/logo-import auf unser CDN kopiert. */
type LogoOrigin = "upload" | "external" | "saved" | null;

export function NewLpWizard({ savedKit }: { savedKit: BrandKit | null }) {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>("choice");
  const [url, setUrl] = React.useState("");
  const [phase, setPhase] = React.useState<ExtractionPhase>("loading");
  const [analyzeError, setAnalyzeError] = React.useState<string | null>(null);

  const [kit, setKit] = React.useState<BrandKit>(makeDefaultKit);
  const [logoCandidates, setLogoCandidates] = React.useState<LogoCandidate[]>(
    [],
  );
  const [logoOrigin, setLogoOrigin] = React.useState<LogoOrigin>(null);
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);

  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // ── Weg A: URL analysieren ─────────────────────────────────────────────
  const analyzedHost = React.useMemo(() => hostFromInput(url), [url]);

  async function startAnalysis() {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    setAnalyzeError(null);
    setPhase("loading");
    setStep("analyzing");
    try {
      const result = await runBrandExtraction(normalized, {
        onPhase: setPhase,
      });
      setKit(result.kit);
      setLogoCandidates(result.logoCandidates);
      setLogoOrigin(result.kit.logo?.url ? "external" : null);
      setStep("confirm");
    } catch (err) {
      setAnalyzeError(
        err instanceof Error && err.message
          ? err.message
          : "Die Analyse hat leider nicht geklappt. Wähle deinen Look einfach selbst.",
      );
      setStep("choice");
    }
  }

  // ── Weg C: gespeicherter Look ──────────────────────────────────────────
  function useSavedLook() {
    if (!savedKit) return;
    setKit(savedKit);
    setLogoCandidates([]);
    setLogoOrigin(savedKit.logo?.url ? "saved" : null);
    setStep("confirm");
  }

  // ── Weg B / „Anpassen" ────────────────────────────────────────────────
  function openManual(base?: BrandKit) {
    if (base) setKit(base);
    setStep("manual");
  }

  function handleKitChange(next: BrandKit, meta?: BrandKitChangeMeta) {
    setKit(next);
    if (meta?.logoOrigin) setLogoOrigin(meta.logoOrigin);
    else if (!next.logo?.url) setLogoOrigin(null);
  }

  // ── Abschluss: Vorlage anlegen ────────────────────────────────────────
  async function createTemplate() {
    setCreating(true);
    setCreateError(null);
    try {
      let finalKit = kit;
      // Fremde Logos dauerhaft auf unser CDN kopieren — Uploads und der
      // gespeicherte Standard liegen bereits bei uns.
      if (finalKit.logo?.url && logoOrigin === "external") {
        const imported = await importLogo(finalKit.logo.url);
        finalKit = { ...finalKit, logo: { ...finalKit.logo, url: imported } };
      }

      if (saveAsDefault) {
        // Best effort — ein fehlgeschlagenes Standard-Speichern darf das
        // Anlegen der Vorlage nicht blockieren.
        try {
          await fetch("/api/brand/default", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kit: finalKit }),
          });
        } catch {
          /* ignore */
        }
      }

      const { theme, brand } = brandKitToTheme(finalKit);
      const content = {
        version: 2,
        theme,
        brand,
        blocks: buildStarterBlocks(),
      };
      const res = await fetch("/api/landing-page-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Neue Vorlage", themeId: "clean", content }),
      });
      const data = (await res.json()) as {
        template?: { id?: string };
        error?: string;
      };
      if (!res.ok || !data.template?.id) {
        setCreateError(
          data.error ?? "Anlegen fehlgeschlagen. Bitte erneut versuchen.",
        );
        setCreating(false);
        return;
      }
      router.push(`/landingpages/${data.template.id}`);
    } catch {
      setCreateError("Verbindung zum Server fehlgeschlagen. Bitte erneut versuchen.");
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/landingpages"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-deep mb-4"
      >
        <ArrowLeft className="size-3.5" />
        Zurück zur Übersicht
      </Link>

      {step === "choice" && (
        <ChoiceStep
          url={url}
          onUrlChange={setUrl}
          onAnalyze={() => void startAnalysis()}
          onManual={() => openManual(makeDefaultKit())}
          onUseSaved={savedKit ? useSavedLook : undefined}
          savedKit={savedKit}
          error={analyzeError}
        />
      )}

      {step === "analyzing" && (
        <AnalyzingStep host={analyzedHost} phase={phase} />
      )}

      {step === "confirm" && (
        <ConfirmStep
          kit={kit}
          logoCandidates={logoCandidates}
          onPickLogo={(candidate) => {
            if (candidate) {
              setKit({ ...kit, logo: { url: candidate.url } });
              setLogoOrigin("external");
            } else {
              const next = { ...kit };
              delete next.logo;
              setKit(next);
              setLogoOrigin(null);
            }
          }}
          onUploadLogo={(publicUrl) => {
            setKit({ ...kit, logo: { url: publicUrl } });
            setLogoOrigin("upload");
          }}
          saveAsDefault={saveAsDefault}
          onSaveAsDefaultChange={setSaveAsDefault}
          onAdjust={() => openManual()}
          onAccept={() => void createTemplate()}
          creating={creating}
          createError={createError}
        />
      )}

      {step === "manual" && (
        <ManualStep
          kit={kit}
          onChange={handleKitChange}
          saveAsDefault={saveAsDefault}
          onSaveAsDefaultChange={setSaveAsDefault}
          onBack={() => setStep("choice")}
          onCreate={() => void createTemplate()}
          creating={creating}
          createError={createError}
        />
      )}
    </div>
  );
}

// ── Schritt 1: Wie soll deine Landingpage aussehen? ─────────────────────────

function ChoiceStep({
  url,
  onUrlChange,
  onAnalyze,
  onManual,
  onUseSaved,
  savedKit,
  error,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  onAnalyze: () => void;
  onManual: () => void;
  onUseSaved?: () => void;
  savedKit: BrandKit | null;
  error: string | null;
}) {
  const canAnalyze = Boolean(normalizeUrl(url));
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">
        Wie soll deine Landingpage aussehen?
      </h1>
      <p className="text-sm text-ink-muted mt-1 mb-6">
        Du startest nie bei null: Wir bauen dir direkt eine fertige Seite in
        deinem Look. Anpassen kannst du danach alles.
      </p>

      {error && (
        <div className="rounded-squircle-md bg-warn-soft/60 px-4 py-3 text-sm text-ink mb-5 leading-relaxed">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Weg A */}
        <div className="bg-surface rounded-squircle-md shadow-card p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
              <Globe className="size-4" />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-ink">Wie meine Website</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Wir übernehmen Logo, Farben &amp; Schrift automatisch von deiner
                Website.
              </p>
              <form
                className="flex items-center gap-2 mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canAnalyze) onAnalyze();
                }}
              >
                <Input
                  value={url}
                  onChange={(e) => onUrlChange(e.target.value)}
                  placeholder="deine-website.de"
                  autoFocus
                  inputMode="url"
                />
                <Button
                  type="submit"
                  variant="brand"
                  disabled={!canAnalyze}
                  iconLeft={<Sparkles className="size-4" />}
                  className="shrink-0"
                >
                  Analysieren
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* Weg C — nur wenn ein Account-Standard existiert */}
        {savedKit && onUseSaved && (
          <button
            type="button"
            onClick={onUseSaved}
            className="w-full text-left bg-surface rounded-squircle-md shadow-card p-5 hover:shadow-card-hover transition-shadow"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                <Check className="size-4" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-ink">
                  Meinen gespeicherten Look verwenden
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Dein zuletzt gespeicherter Markenlook, sofort startklar.
                </p>
                <span className="flex items-center gap-1.5 mt-2.5">
                  <KitDots kit={savedKit} />
                  <span className="text-[11px] text-ink-muted ml-1">
                    {getFontPair(savedKit.fontPairId)?.label ?? savedKit.fontPairId}
                  </span>
                </span>
              </div>
              <ArrowRight className="size-4 text-ink-muted shrink-0 mt-1" />
            </div>
          </button>
        )}

        {/* Weg B */}
        <button
          type="button"
          onClick={onManual}
          className="w-full text-left bg-surface rounded-squircle-md shadow-card p-5 hover:shadow-card-hover transition-shadow"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
              <Palette className="size-4" />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-ink">Eigenen Look wählen</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Farben, Schrift &amp; Form selbst bestimmen. Dauert nur eine
                Minute.
              </p>
            </div>
            <ArrowRight className="size-4 text-ink-muted shrink-0 mt-1" />
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Schritt 2 (Weg A): Analyse läuft ────────────────────────────────────────

function AnalyzingStep({
  host,
  phase,
}: {
  host: string;
  phase: ExtractionPhase;
}) {
  return (
    <div className="bg-surface rounded-squircle-md shadow-card px-6 py-12 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep mb-4">
        <Loader2 className="size-5 animate-spin" />
      </span>
      <h2 className="text-lg font-bold text-ink">
        {phase === "analyzing"
          ? "Wir lesen Farben, Schrift und Logo aus…"
          : `Wir schauen uns ${host || "deine Website"} an…`}
      </h2>
      <p className="text-sm text-ink-muted mt-1.5">
        Das dauert etwa 5 bis 10 Sekunden.
      </p>
    </div>
  );
}

// ── Schritt 3: Bestätigungs-Screen („Passt das so?") ────────────────────────

function ConfirmStep({
  kit,
  logoCandidates,
  onPickLogo,
  onUploadLogo,
  saveAsDefault,
  onSaveAsDefaultChange,
  onAdjust,
  onAccept,
  creating,
  createError,
}: {
  kit: BrandKit;
  logoCandidates: LogoCandidate[];
  onPickLogo: (candidate: LogoCandidate | null) => void;
  onUploadLogo: (publicUrl: string) => void;
  saveAsDefault: boolean;
  onSaveAsDefaultChange: (v: boolean) => void;
  onAdjust: () => void;
  onAccept: () => void;
  creating: boolean;
  createError: string | null;
}) {
  const pair = getFontPair(kit.fontPairId);
  const host = kit.sourceUrl ? hostFromInput(kit.sourceUrl) : "";

  return (
    <div className="bg-surface rounded-squircle-md shadow-card p-6">
      <h1 className="text-xl font-bold text-ink">Passt das so?</h1>
      <p className="text-sm text-ink-muted mt-1">
        {host
          ? `Das haben wir auf ${host} gefunden: dein Look für die neue Seite.`
          : "Dein Look für die neue Seite."}
      </p>

      {(logoCandidates.length > 0 || kit.logo?.url) && (
        <div className="mt-5">
          <Label>Logo</Label>
          <LogoChooser
            kit={kit}
            candidates={logoCandidates}
            onPick={onPickLogo}
            onUpload={onUploadLogo}
          />
        </div>
      )}

      {/* Kompakte Kit-Zusammenfassung */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Farben">
          <KitDots kit={kit} />
        </SummaryTile>
        <SummaryTile label="Schrift">
          <span className="text-xs font-semibold text-ink truncate">
            {pair?.label ?? kit.fontPairId}
          </span>
        </SummaryTile>
        <SummaryTile label="Rundungen">
          <span className="text-xs font-semibold text-ink">
            {RADIUS_LABELS[kit.radius]}
          </span>
        </SummaryTile>
        <SummaryTile label="Schatten">
          <span className="text-xs font-semibold text-ink">
            {SHADOW_LABELS[kit.shadow]}
          </span>
        </SummaryTile>
      </div>

      <div className="mt-5">
        <Label>So wird deine Seite aussehen</Label>
        <MiniHeroPreview kit={kit} className="mt-1.5" />
      </div>

      <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
        <Checkbox
          checked={saveAsDefault}
          onCheckedChange={(c) => onSaveAsDefaultChange(c === true)}
        />
        <span className="text-sm text-ink">
          Als Standard für neue Seiten speichern
        </span>
      </label>

      {createError && (
        <p className="text-sm text-danger mt-4">{createError}</p>
      )}

      <div className="flex items-center justify-between gap-3 mt-6">
        <Button type="button" variant="ghost" onClick={onAdjust} disabled={creating}>
          Anpassen
        </Button>
        <Button
          type="button"
          variant="brand"
          onClick={onAccept}
          disabled={creating}
          iconLeft={
            creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )
          }
        >
          {creating ? "Seite wird gebaut…" : "Sieht gut aus"}
        </Button>
      </div>
    </div>
  );
}

/** Logo-Kandidaten-Auswahl (max. 6) + Upload-Fallback + „Ohne Logo". */
function LogoChooser({
  kit,
  candidates,
  onPick,
  onUpload,
}: {
  kit: BrandKit;
  candidates: LogoCandidate[];
  onPick: (candidate: LogoCandidate | null) => void;
  onUpload: (publicUrl: string) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currentUrl = kit.logo?.url ?? null;
  const isUploaded =
    Boolean(currentUrl) && !candidates.some((c) => c.url === currentUrl);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("kind", "logo");
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = (await res.json()) as {
        media?: { publicUrl?: string };
        error?: string;
      };
      if (!res.ok || !data.media?.publicUrl) {
        setError(data.error ?? "Upload fehlgeschlagen. Bitte erneut versuchen.");
        return;
      }
      onUpload(data.media.publicUrl);
    } catch {
      setError("Upload fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-2">
        {candidates.map((c) => {
          const active = currentUrl === c.url;
          return (
            <button
              key={c.url}
              type="button"
              onClick={() => onPick(c)}
              className={cn(
                "flex h-14 w-24 items-center justify-center rounded-squircle-sm border bg-white p-2 transition-colors",
                active
                  ? "border-brand ring-2 ring-brand/30"
                  : "border-line hover:border-ink/20",
              )}
              title="Dieses Logo verwenden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.url}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            </button>
          );
        })}

        {isUploaded && currentUrl && (
          <span className="flex h-14 w-24 items-center justify-center rounded-squircle-sm border border-brand ring-2 ring-brand/30 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          </span>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-14 w-24 flex-col items-center justify-center gap-1 rounded-squircle-sm border border-dashed border-line text-ink-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-60"
          title="Eigenes Logo hochladen"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          <span className="text-[10px] font-semibold">Hochladen</span>
        </button>

        <button
          type="button"
          onClick={() => onPick(null)}
          className={cn(
            "flex h-14 w-24 items-center justify-center rounded-squircle-sm border text-[11px] font-semibold transition-colors",
            currentUrl
              ? "border-line text-ink-muted hover:text-ink hover:border-ink/30"
              : "border-brand ring-2 ring-brand/30 text-brand-deep",
          )}
        >
          Ohne Logo
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}

function SummaryTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-squircle-sm bg-surface-soft px-3 py-2.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
        {label}
      </div>
      <div className="flex items-center min-h-5">{children}</div>
    </div>
  );
}

function KitDots({ kit }: { kit: BrandKit }) {
  const dots = [
    kit.colors.primary,
    ...(kit.colors.accent ? [kit.colors.accent] : []),
    kit.colors.bg === "dark" ? "#0b0c10" : "#ffffff",
  ];
  return (
    <span className="flex items-center -space-x-1">
      {dots.map((hex, i) => (
        <span
          key={`${hex}_${i}`}
          className="inline-block size-4 rounded-full ring-2 ring-surface"
          style={{ background: hex }}
        />
      ))}
    </span>
  );
}

// ── Schritt „Manuell" (Weg B / Anpassen) ────────────────────────────────────

function ManualStep({
  kit,
  onChange,
  saveAsDefault,
  onSaveAsDefaultChange,
  onBack,
  onCreate,
  creating,
  createError,
}: {
  kit: BrandKit;
  onChange: (next: BrandKit, meta?: BrandKitChangeMeta) => void;
  saveAsDefault: boolean;
  onSaveAsDefaultChange: (v: boolean) => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
  createError: string | null;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Dein Look</h1>
      <p className="text-sm text-ink-muted mt-1 mb-6">
        Wenige Entscheidungen, großer Effekt: Die Vorschau zeigt live, wie
        deine Seite aussehen wird.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,minmax(0,340px)] gap-6 items-start">
        <div className="bg-surface rounded-squircle-md shadow-card p-5">
          <BrandKitGroups kit={kit} onChange={onChange} />
        </div>
        <div className="lg:sticky lg:top-4">
          <Label>Live-Vorschau</Label>
          <MiniHeroPreview kit={kit} className="mt-1.5" />

          <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
            <Checkbox
              checked={saveAsDefault}
              onCheckedChange={(c) => onSaveAsDefaultChange(c === true)}
            />
            <span className="text-sm text-ink">
              Als Standard für neue Seiten speichern
            </span>
          </label>

          {createError && (
            <p className="text-sm text-danger mt-4">{createError}</p>
          )}

          <div className="flex items-center justify-between gap-3 mt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={creating}
            >
              Zurück
            </Button>
            <Button
              type="button"
              variant="brand"
              onClick={onCreate}
              disabled={creating}
              iconLeft={
                creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )
              }
            >
              {creating ? "Seite wird gebaut…" : "Landingpage erstellen"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── URL-Helfer ──────────────────────────────────────────────────────────────

/** „deine-website.de" → „https://deine-website.de"; ungültig → null. */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hostFromInput(input: string): string {
  const normalized = normalizeUrl(input);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
