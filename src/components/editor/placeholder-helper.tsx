"use client";

import * as React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  ScanLine,
  Copy,
  QrCode,
  ImageIcon,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/**
 * `<PlaceholderHelper />` — zeigt dem Nutzer:
 *
 * 1. Welche Platzhalter in seinem Google-Docs PDF-Template verfügbar sind
 *    (Standard-Variablen + dynamische CSV-Spalten).
 * 2. Einen Scan-Button, der das Dokument analysiert und meldet, welche
 *    Platzhalter gefunden wurden, ob die QR- und Thumbnail-Marker bereits
 *    eingefügt sind und wieviele Bilder das Dokument enthält.
 * 3. Download-Links für die beiden Marker-Vorlagen (QR / Thumb).
 *
 * Wird in zwei Kontexten verwendet:
 *  - Wizard Step 5 (PDF-Brief): voller Modus mit Überschriften.
 *  - GDocs Segment-Editor: kompakter Modus (`compact`), nur Chips + Scan + Download.
 */

const STANDARD_PLACEHOLDERS = [
  "firstName",
  "lastName",
  "landingpageUrl",
] as const;

export interface PlaceholderHelperProps {
  /** Google-Docs URL, die der Nutzer eingegeben hat. Leerstring = kein Scan. */
  googleDocsUrl: string;
  /** CSV-Spalten, die der Nutzer gemappt hat. Werden als zusätzliche
   *  verfügbare Platzhalter angezeigt. */
  csvColumns?: string[];
  /** Kompakt-Modus für die Inline-Verwendung im Segment-Editor. Default: false. */
  compact?: boolean;
}

interface ScanResult {
  placeholders: string[];
  hasQrMarker: boolean;
  hasThumbMarker: boolean;
  imageCount: number;
}

function isValidDocsUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("docs.google.com");
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function PlaceholderHelper({
  googleDocsUrl,
  csvColumns = [],
  compact = false,
}: PlaceholderHelperProps) {
  const { toast } = useToast();
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);

  const urlValid = isValidDocsUrl(googleDocsUrl);

  // Liste der verfügbaren Platzhalter:
  //  - immer firstName / lastName / landingpageUrl
  //  - plus jede CSV-Spalte (deduped, ohne Standard-Namen)
  const availablePlaceholders = React.useMemo(() => {
    const standard = [...STANDARD_PLACEHOLDERS] as string[];
    const seen = new Set(standard.map(normalizeName));
    const extras: string[] = [];
    for (const col of csvColumns) {
      const trimmed = col.trim();
      if (!trimmed) continue;
      const norm = normalizeName(trimmed);
      if (seen.has(norm)) continue;
      seen.add(norm);
      extras.push(trimmed);
    }
    return { standard, extras };
  }, [csvColumns]);

  // Für die Validierung gefundener Platzhalter: alles, was wir kennen.
  const knownPlaceholderSet = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of availablePlaceholders.standard) set.add(normalizeName(p));
    for (const p of availablePlaceholders.extras) set.add(normalizeName(p));
    // landingpage_url als Alias für landingpageUrl akzeptieren.
    set.add("landingpage_url");
    return set;
  }, [availablePlaceholders]);

  // Reset Scan-State, wenn die URL sich ändert.
  React.useEffect(() => {
    setScanResult(null);
    setScanError(null);
  }, [googleDocsUrl]);

  async function handleScan() {
    if (!urlValid || scanning) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch("/api/docx/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleDocsUrl }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = "Scan fehlgeschlagen.";
        try {
          const parsed = JSON.parse(txt) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch {
          if (txt) msg = txt;
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as ScanResult;
      setScanResult(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Scan fehlgeschlagen.";
      setScanError(msg);
    } finally {
      setScanning(false);
    }
  }

  async function copyPlaceholder(name: string) {
    const text = `{{${name}}}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({
        variant: "success",
        title: "Kopiert",
        description: `${text} ist jetzt in der Zwischenablage.`,
        duration: 2000,
      });
    } catch {
      toast({
        variant: "danger",
        title: "Kopieren fehlgeschlagen",
        description: "Bitte den Platzhalter manuell markieren.",
      });
    }
  }

  if (!urlValid) {
    return null;
  }

  return (
    <div
      className={cn(
        compact
          ? "space-y-4 border-t border-line pt-4"
          : "rounded-squircle-md border border-line bg-surface p-5 space-y-5",
      )}
    >
      {/* Section 1: Available placeholders */}
      <section>
        {!compact && (
          <header className="mb-2">
            <h3 className="text-sm font-semibold text-ink">
              Verfügbare Platzhalter
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Klick einen Platzhalter an, um ihn zu kopieren — füge ihn dann
              in dein Google Docs ein.
            </p>
          </header>
        )}
        {compact && (
          <p className="text-xs font-medium text-ink mb-2">
            Verfügbare Platzhalter
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {availablePlaceholders.standard.map((name) => (
            <PlaceholderChip
              key={name}
              name={name}
              onClick={() => copyPlaceholder(name)}
            />
          ))}
          {availablePlaceholders.extras.map((name) => (
            <PlaceholderChip
              key={name}
              name={name}
              onClick={() => copyPlaceholder(name)}
            />
          ))}
        </div>
      </section>

      {/* Section 2: Scan */}
      <section className="pt-4 border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <ScanLine className="size-4 text-brand-deep shrink-0 mt-0.5" />
            <div className="min-w-0">
              {!compact && (
                <p className="text-sm font-semibold text-ink">
                  Dokument-Scan
                </p>
              )}
              <p className="text-xs text-ink-muted leading-snug">
                Prüfe, welche Platzhalter und Marker dein Google Docs bereits
                enthält.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant={scanResult ? "subtle" : "brand"}
            size="sm"
            onClick={handleScan}
            disabled={scanning}
            loading={scanning}
            iconLeft={!scanning ? <ScanLine className="size-3.5" /> : undefined}
          >
            {scanResult ? "Erneut scannen" : "Dokument scannen"}
          </Button>
        </div>

        {scanError && (
          <div className="mt-3 flex gap-2 rounded-squircle-sm border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <span>{scanError}</span>
          </div>
        )}

        {scanResult && (
          <div className="mt-3 space-y-3">
            <ScanPlaceholderList
              found={scanResult.placeholders}
              knownSet={knownPlaceholderSet}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <MarkerStatus
                kind="qr"
                present={scanResult.hasQrMarker}
              />
              <MarkerStatus
                kind="thumb"
                present={scanResult.hasThumbMarker}
              />
            </div>
            <p className="text-[11px] text-ink-muted">
              {scanResult.imageCount === 0
                ? "Keine Bilder im Dokument gefunden."
                : `${scanResult.imageCount} ${scanResult.imageCount === 1 ? "Bild" : "Bilder"} im Dokument gefunden.`}
            </p>
          </div>
        )}
      </section>

      {/* Section 3: Marker downloads */}
      <section className="pt-4 border-t border-line">
        {!compact && (
          <header className="mb-2">
            <h3 className="text-sm font-semibold text-ink">
              Marker-Vorlagen
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Lade die Bild-Platzhalter herunter und füge sie in dein Google
              Docs ein — der Worker tauscht sie pro Lead gegen das echte Bild
              aus.
            </p>
          </header>
        )}
        {compact && (
          <p className="text-xs font-medium text-ink mb-2">
            Marker-Vorlagen
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            iconLeft={<QrCode className="size-3.5" />}
          >
            <a
              href="/api/markers/qr"
              download="videocomet-marker-qr.png"
            >
              QR-Vorlage
              <Download className="size-3.5 ml-1.5 opacity-70" />
            </a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            iconLeft={<ImageIcon className="size-3.5" />}
          >
            <a
              href="/api/markers/thumb"
              download="videocomet-marker-thumb.png"
            >
              Thumbnail-Vorlage
              <Download className="size-3.5 ml-1.5 opacity-70" />
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface PlaceholderChipProps {
  name: string;
  /** Optional "found" state: true = matched known, false = unknown variable. */
  tone?: "default" | "ok" | "warn";
  onClick?: () => void;
  title?: string;
}

function PlaceholderChip({
  name,
  tone = "default",
  onClick,
  title,
}: PlaceholderChipProps) {
  const [flash, setFlash] = React.useState(false);

  function handleClick() {
    if (!onClick) return;
    onClick();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 350);
  }

  const isClickable = Boolean(onClick);
  const Icon =
    tone === "ok"
      ? CheckCircle2
      : tone === "warn"
        ? AlertTriangle
        : Copy;

  const toneClasses =
    tone === "ok"
      ? "bg-ok-soft text-ink border-ok/30"
      : tone === "warn"
        ? "bg-warn-soft text-ink border-warn/40"
        : "bg-brand-soft text-brand-deep border-brand-200";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isClickable}
      title={title ?? (isClickable ? `{{${name}}} kopieren` : `{{${name}}}`)}
      aria-label={
        isClickable ? `Platzhalter {{${name}}} kopieren` : `{{${name}}}`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-all duration-150 ease-spring",
        toneClasses,
        isClickable &&
          "cursor-pointer hover:-translate-y-0.5 hover:shadow-card",
        !isClickable && "cursor-default opacity-95",
        flash && "ring-2 ring-brand ring-offset-1 ring-offset-surface",
      )}
    >
      <Icon className="size-3 shrink-0 opacity-75" />
      <span className="truncate">{`{{${name}}}`}</span>
    </button>
  );
}

function ScanPlaceholderList({
  found,
  knownSet,
}: {
  found: string[];
  knownSet: Set<string>;
}) {
  if (found.length === 0) {
    return (
      <div className="flex gap-2 rounded-squircle-sm border border-line bg-surface-soft p-3 text-xs text-ink-muted">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Keine Platzhalter im Dokument gefunden. Füge z.&nbsp;B.{" "}
          <code className="font-mono">{"{{firstName}}"}</code> in dein Google
          Docs ein.
        </span>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-ink mb-1.5">
        Im Dokument gefunden ({found.length})
      </p>
      <div className="flex flex-wrap gap-1.5">
        {found.map((name) => {
          const ok = knownSet.has(normalizeName(name));
          return (
            <PlaceholderChip
              key={name}
              name={name}
              tone={ok ? "ok" : "warn"}
              title={
                ok
                  ? `{{${name}}} wird beim Rendern ersetzt.`
                  : `{{${name}}} ist keine bekannte Variable und bleibt im PDF stehen.`
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function MarkerStatus({
  kind,
  present,
}: {
  kind: "qr" | "thumb";
  present: boolean;
}) {
  const label = kind === "qr" ? "QR-Platzhalter" : "Thumbnail-Platzhalter";
  const Icon = kind === "qr" ? QrCode : ImageIcon;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-squircle-sm border p-2.5 text-xs",
        present
          ? "border-ok/30 bg-ok-soft text-ink"
          : "border-warn/30 bg-warn-soft text-ink",
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-squircle-sm",
          present ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
        )}
      >
        {present ? (
          <CheckCircle2 className="size-3.5" />
        ) : (
          <AlertTriangle className="size-3.5" />
        )}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink flex items-center gap-1">
          <Icon className="size-3 opacity-70" />
          {label}
        </p>
        <p className="text-ink-muted leading-snug mt-0.5">
          {present
            ? "erkannt — wird pro Lead ersetzt."
            : "fehlt — lade die Vorlage unten herunter und füge sie ein."}
        </p>
      </div>
    </div>
  );
}
