"use client";

import * as React from "react";
import { Loader2, AlertTriangle, FileClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DraftEnvelope, DraftSaveStatus } from "./use-wizard-draft";

/**
 * Formatiert einen ISO-Timestamp als „heute 14:32", „gestern 09:11" oder
 * „2026-05-30 14:12" — relativ zur Anzeigezeit, damit Banner und Pille
 * menschen-lesbar bleiben.
 */
function formatDraftDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  const hhmm = date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `heute ${hhmm}`;
  if (isYesterday) return `gestern ${hhmm}`;
  return `${date.toLocaleDateString("de-DE")} ${hhmm}`;
}

/**
 * „Vor 3 Sek.", „Vor 1 Min." — sehr knapp, da nur als sekundäre Info in der
 * Pille gezeigt.
 */
function formatRelative(iso: string, nowMs: number): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (diffSec < 5) return "gerade eben";
  if (diffSec < 60) return `vor ${diffSec} Sek.`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} Std.`;
  return formatDraftDate(iso);
}

export interface DraftRestoreBannerProps {
  draft: DraftEnvelope;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Dezentes Banner ÜBER dem Wizard. Wird nur gerendert, wenn beim Mount ein
 * Entwurf gefunden wurde, dessen `savedAt` der Nutzer noch nicht abgenickt
 * hat („Fortsetzen" oder „Verwerfen").
 */
export function DraftRestoreBanner({
  draft,
  onRestore,
  onDiscard,
}: DraftRestoreBannerProps) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-squircle-md bg-surface shadow-card px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-brand text-white">
          <FileClock className="size-4" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-ink">
            Du hattest einen Entwurf vom {formatDraftDate(draft.savedAt)}.
          </p>
          <p className="text-xs text-ink-muted">
            Hier weitermachen? Wir setzen Dich auf Schritt {draft.step + 1}{" "}
            wieder ab.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" onClick={onDiscard}>
          Verwerfen
        </Button>
        <Button onClick={onRestore}>Fortsetzen</Button>
      </div>
    </div>
  );
}

export interface DraftStatusPillProps {
  status: DraftSaveStatus;
  lastSavedAt: string | null;
  className?: string;
}

/**
 * Kleine, kompakte Status-Anzeige für die Sticky-Footer-Toolbar. Spiegelt
 * den letzten Auto-Save-Zustand wider:
 *
 *   - "saving" → blinkender Loader, Text „Speichere Entwurf …"
 *   - "saved"  → grüner Punkt, Text „Entwurf gespeichert · vor 3 Sek."
 *   - "error"  → rote Pille, Text „Speichern fehlgeschlagen"
 *   - "idle"   → nichts (verhindert visuelles Rauschen vor erstem Save)
 */
export function DraftStatusPill({
  status,
  lastSavedAt,
  className,
}: DraftStatusPillProps) {
  // Re-render alle 15 s, damit „vor X Sek." nicht einfriert.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (status !== "saved") return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [status]);

  if (status === "idle" && !lastSavedAt) return null;

  if (status === "saving") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted",
          className,
        )}
      >
        <Loader2 className="size-3 animate-spin" />
        Speichere Entwurf …
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger",
          className,
        )}
      >
        <AlertTriangle className="size-3" />
        Speichern fehlgeschlagen
      </span>
    );
  }

  // "saved" oder „idle mit historischem Stand"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-ok" />
      Entwurf gespeichert
      {lastSavedAt && (
        <span className="text-ok/70">· {formatRelative(lastSavedAt, now)}</span>
      )}
    </span>
  );
}
