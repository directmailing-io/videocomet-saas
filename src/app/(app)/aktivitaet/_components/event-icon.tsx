"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronsDown,
  Clock,
  Eye,
  FileDown,
  Link as LinkIcon,
  Mail,
  Mailbox,
  MailX,
  MousePointerClick,
  Play,
  Target,
  Volume2,
  VolumeX,
  Activity,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aktivitäts-Event-Typen — als String-Literal-Union, weil die Source-of-Truth
 * in agent-1 (DB/queries) liegt und wir hier nur visuell rendern.
 * Unbekannte Kinds fallen graceful auf eine generische Activity-Icon.
 */
export type ActivityKind =
  | "page_view"
  | "video_play"
  | "video_progress"
  | "video_ended"
  | "video_mute"
  | "video_unmute"
  | "cta_click"
  | "cta_hover"
  | "scroll_depth"
  | "time_on_page"
  | "link_click"
  | (string & Record<never, never>);

/**
 * Label + semantische Kategorie pro Kind. Die Kategorie steuert Farbe und
 * Hintergrund — nur eine Akzentfarbe (brand) für „neutral interaktiv“,
 * sonst semantisches ok/warn/danger sparsam eingesetzt.
 */
type IconCategory = "view" | "play" | "milestone" | "interact" | "audio" | "neutral";

const KIND_TO_ICON: Record<
  string,
  { Icon: React.ComponentType<{ className?: string }>; category: IconCategory; label: string }
> = {
  page_view: { Icon: Eye, category: "view", label: "Seite aufgerufen" },
  video_play: { Icon: Play, category: "play", label: "Video gestartet" },
  video_progress: { Icon: CircleDot, category: "play", label: "Video fortgeschritten" },
  video_ended: { Icon: CheckCircle2, category: "milestone", label: "Video beendet" },
  video_mute: { Icon: VolumeX, category: "audio", label: "Stumm geschaltet" },
  video_unmute: { Icon: Volume2, category: "audio", label: "Ton eingeschaltet" },
  cta_click: { Icon: MousePointerClick, category: "interact", label: "CTA geklickt" },
  cta_hover: { Icon: Target, category: "interact", label: "CTA überflogen" },
  scroll_depth: { Icon: ChevronsDown, category: "neutral", label: "Tief gescrollt" },
  time_on_page: { Icon: Clock, category: "neutral", label: "Verweildauer" },
  link_click: { Icon: LinkIcon, category: "interact", label: "Link geklickt" },
  form_submit: { Icon: Mail, category: "milestone", label: "Formular-Anfrage" },
  letter_exported: { Icon: FileDown, category: "neutral", label: "Brief-PDF heruntergeladen" },
  letter_sent: { Icon: Mailbox, category: "milestone", label: "Brief per Post versendet" },
  letter_status_changed: { Icon: Mailbox, category: "neutral", label: "Brief-Status geändert" },
  email_unsubscribe: { Icon: MailX, category: "neutral", label: "Vom E-Mail-Verteiler abgemeldet" },
};

const categoryStyles: Record<IconCategory, { bg: string; fg: string }> = {
  view: { bg: "bg-surface-muted", fg: "text-ink-soft" },
  play: { bg: "bg-brand-soft", fg: "text-brand-deep" },
  milestone: { bg: "bg-ok-soft", fg: "text-ok" },
  interact: { bg: "bg-warn-soft", fg: "text-warn" },
  audio: { bg: "bg-surface-muted", fg: "text-ink-muted" },
  neutral: { bg: "bg-surface-muted", fg: "text-ink-muted" },
};

export interface EventIconProps {
  kind: ActivityKind;
  className?: string;
  size?: "sm" | "md";
}

export function EventIcon({ kind, className, size = "md" }: EventIconProps) {
  const entry = KIND_TO_ICON[kind] ?? {
    Icon: Activity,
    category: "neutral" as IconCategory,
    label: "Aktivität",
  };
  const { Icon, category, label } = entry;
  const styles = categoryStyles[category];
  const box = size === "sm" ? "size-7" : "size-8";
  const icon = size === "sm" ? "size-3.5" : "size-4";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        box,
        styles.bg,
        className,
      )}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon className={cn(icon, styles.fg)} />
    </span>
  );
}

/**
 * Lookup für die textuelle Default-Beschreibung eines Events — wird vom
 * FeedRow als Fallback verwendet, falls das payload-Feld keinen eigenen
 * Untertitel mitliefert.
 */
export function describeKind(kind: ActivityKind, payload?: Record<string, unknown>): string {
  switch (kind) {
    case "page_view":
      return "Seite aufgerufen";
    case "video_play":
      return "Video gestartet";
    case "video_progress": {
      // Bridge schickt `{ atSec, duration }` — Prozent berechnen wir hier
      // serverseitig nicht, sondern aus den beiden Feldern.
      const atSec =
        payload && typeof payload.atSec === "number"
          ? (payload.atSec as number)
          : null;
      const duration =
        payload && typeof payload.duration === "number"
          ? (payload.duration as number)
          : null;
      if (atSec !== null && duration && duration > 0) {
        const pct = Math.min(100, Math.round((atSec / duration) * 100));
        return `Video gesehen ${pct} %`;
      }
      if (atSec !== null) {
        return `Video bei ${atSec}s`;
      }
      return "Video fortgeschritten";
    }
    case "video_ended":
      return "Video komplett gesehen";
    case "video_mute":
      return "Ton stumm geschaltet";
    case "video_unmute":
      return "Ton eingeschaltet";
    case "cta_click": {
      const label =
        payload && typeof payload.label === "string" ? (payload.label as string) : null;
      return label ? `CTA „${label}" geklickt` : "CTA geklickt";
    }
    case "cta_hover":
      return "CTA überflogen";
    case "scroll_depth": {
      // Bridge schickt das Bucket-Maximum als `maxPct` (10/20/30/…/100).
      // Kompatibilität: ältere Bridge-Versionen sendeten evtl. `percent`.
      const raw =
        payload && typeof payload.maxPct === "number"
          ? (payload.maxPct as number)
          : payload && typeof payload.percent === "number"
            ? (payload.percent as number)
            : null;
      if (raw !== null) {
        return `${Math.round(raw)} % gescrollt`;
      }
      return "Tief gescrollt";
    }
    case "time_on_page": {
      const sec =
        payload && typeof payload.seconds === "number"
          ? Math.round(payload.seconds as number)
          : null;
      return sec !== null ? `${sec}s auf der Seite` : "Verweildauer";
    }
    case "link_click": {
      const href =
        payload && typeof payload.href === "string" ? (payload.href as string) : null;
      return href ? `Link geklickt: ${href}` : "Link geklickt";
    }
    case "form_submit": {
      const name =
        payload && typeof payload.name === "string" && payload.name.trim().length > 0
          ? (payload.name as string).trim()
          : null;
      const email =
        payload && typeof payload.email === "string" && payload.email.trim().length > 0
          ? (payload.email as string).trim()
          : null;
      if (name && email) return `Formular-Anfrage von ${name} (${email})`;
      if (name) return `Formular-Anfrage von ${name}`;
      return "Formular-Anfrage";
    }
    case "letter_exported":
      return payload?.partial === true
        ? "Brief-PDF heruntergeladen (Teilexport)"
        : "Brief-PDF heruntergeladen";
    case "letter_sent": {
      const sentAt =
        payload && typeof payload.sentAt === "string" ? payload.sentAt : null;
      if (sentAt) {
        try {
          const d = new Intl.DateTimeFormat("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(new Date(sentAt));
          return `Brief per Post versendet — Versanddatum ${d}`;
        } catch {
          // fällt auf das Label ohne Datum zurück
        }
      }
      return "Brief per Post versendet";
    }
    case "letter_status_changed": {
      if (payload?.returned === true)
        return "Brief kam als Rückläufer zurück (unzustellbar)";
      if (payload?.returned === false) return "Rückläufer-Markierung entfernt";
      const from =
        payload && typeof payload.from === "string"
          ? LETTER_STATUS_DE[payload.from] ?? payload.from
          : null;
      const to =
        payload && typeof payload.to === "string"
          ? LETTER_STATUS_DE[payload.to] ?? payload.to
          : null;
      if (from && to) return `Brief-Status geändert: ${from} → ${to}`;
      if (to) return `Brief-Status auf „${to}“ gesetzt`;
      return "Brief-Status geändert";
    }
    case "email_unsubscribe":
      return "Vom E-Mail-Verteiler abgemeldet";
    default:
      // Unbekannte Kinds nie roh-englisch anzeigen — generisches Label.
      return KIND_TO_ICON[kind]?.label ?? "Aktivität";
  }
}

const LETTER_STATUS_DE: Record<string, string> = {
  open: "Offen",
  in_progress: "In Bearbeitung",
  sent: "Versendet",
  discarded: "Aussortiert",
};
