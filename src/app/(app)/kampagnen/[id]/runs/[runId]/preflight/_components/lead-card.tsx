"use client";

import * as React from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Pre-Flight-Status — exakt der Enum-Vertrag aus dem Backend.
 */
export type PreflightStatus =
  | "pending"
  | "running"
  | "ok"
  | "url_dead"
  | "url_redirect"
  | "missing_field"
  | "duplicate"
  | "tls_error"
  | "slow"
  | "bot_block"
  | "screenshot_unavailable"
  | "unknown_error";

/**
 * Lead-Datensatz, wie er aus `/api/runs/[id]/preflight/leads` kommt.
 * Wird hier exportiert, damit Grid, Lightbox & Toolbar dieselbe Quelle
 * der Wahrheit teilen.
 */
export interface PreflightLead {
  id: string;
  runId: string;
  rowIndex: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyName: string | null;
  websiteUrl: string | null;
  preflightStatus: PreflightStatus;
  preflightFinalUrl: string | null;
  preflightHttpStatus: number | null;
  preflightDurationMs: number | null;
  preflightErrorMessage: string | null;
  preflightScreenshotUrl: string | null;
  preflightAttempts: number;
  duplicateOfLeadId: string | null;
  removedAt: string | null;
  approvedAt: string | null;
}

/**
 * Status-Klassifizierung in drei Schweregrade.
 * - "danger" markiert "Lead defekt, Video würde peinlich aussehen"
 * - "warn"   markiert "Lead wahrscheinlich problematisch, prüfen"
 * - "info"   markiert "Lead funktional unvollständig, aber rettbar"
 * - "ok"     markiert "alles in Ordnung — keine visuelle Auszeichnung"
 * - "neutral" markiert nicht-finale Phasen (pending/running)
 */
export type StatusSeverity = "danger" | "warn" | "info" | "ok" | "neutral";

export function severityOf(status: PreflightStatus): StatusSeverity {
  switch (status) {
    case "url_dead":
    case "tls_error":
      return "danger";
    case "url_redirect":
    case "slow":
    case "bot_block":
      return "warn";
    case "missing_field":
    case "duplicate":
    case "screenshot_unavailable":
    case "unknown_error":
      return "info";
    case "ok":
      return "ok";
    default:
      return "neutral";
  }
}

export const STATUS_LABEL: Record<PreflightStatus, string> = {
  pending: "Wartet",
  running: "Lädt…",
  ok: "OK",
  url_dead: "URL tot",
  url_redirect: "Umleitung",
  missing_field: "Daten unvollständig",
  duplicate: "Duplikat",
  tls_error: "TLS-Fehler",
  slow: "Langsam",
  bot_block: "Bot-Block",
  screenshot_unavailable: "Screenshot fehlt",
  unknown_error: "Fehler",
};

/**
 * Sichtbare Counts-Konfiguration für die Filter-Toolbar.
 * (Wird vom Client zusammengezählt.)
 */
export interface StatusCounts {
  pending: number;
  running: number;
  ok: number;
  problematic: number;
  removed: number;
  total: number;
}

export function isProblematic(status: PreflightStatus): boolean {
  const s = severityOf(status);
  return s === "danger" || s === "warn" || s === "info";
}

/**
 * Display-Helpers, von Grid + Lightbox geteilt.
 */
export function displayName(lead: PreflightLead): string {
  if (lead.fullName && lead.fullName.trim().length > 0) return lead.fullName;
  const parts = [lead.firstName, lead.lastName].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  return `Lead #${lead.rowIndex + 1}`;
}

export function displayCompany(lead: PreflightLead): string {
  return lead.companyName?.trim() || "—";
}

export function displayDomain(lead: PreflightLead): string {
  const url = lead.preflightFinalUrl ?? lead.websiteUrl;
  if (!url) return "—";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function displayDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return `${s.toFixed(s >= 10 ? 0 : 1)} s`;
}

const severityTopBorder: Record<StatusSeverity, string> = {
  danger: "before:bg-danger",
  warn: "before:bg-warn",
  info: "before:bg-ink-muted/40",
  ok: "before:bg-transparent",
  neutral: "before:bg-transparent",
};

const severityBadgeVariant: Record<
  StatusSeverity,
  "danger" | "warn" | "neutral" | "brand"
> = {
  danger: "danger",
  warn: "warn",
  info: "neutral",
  ok: "neutral",
  neutral: "brand",
};

export interface LeadCardProps {
  lead: PreflightLead;
  selected: boolean;
  focused: boolean;
  onSelectToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRetryScreenshot: () => void;
}

/**
 * Eine einzelne Karte im Grid. Bewusst memoized — die Card-Komponente
 * darf nur re-rendern, wenn sich ihre Inputs ändern. Sonst macht das
 * SSE-Tick bei 500 Karten 500× Reconciliation.
 *
 * Interaktion:
 *  - Linksklick / Space / Enter → Auswahl togglen
 *  - Rechtsklick                 → Context-Menu (Parent öffnet es)
 */
function LeadCardImpl({
  lead,
  selected,
  focused,
  onSelectToggle,
  onContextMenu,
  onRetryScreenshot,
}: LeadCardProps) {
  const sev = severityOf(lead.preflightStatus);
  const problematic = isProblematic(lead.preflightStatus);
  const status = lead.preflightStatus;

  const showSpinner = status === "running";
  const showSkeleton = status === "pending";
  const hasScreenshot = Boolean(lead.preflightScreenshotUrl);

  // Space + Enter werden bewusst NICHT hier behandelt — das macht der
  // globale useKeyboardShortcuts-Hook über `focusedLeadId`. Sonst hätten
  // wir zwei Toggle-Aufrufe und die Auswahl würde sich selber aufheben.
  function handleKeyDown(_e: React.KeyboardEvent<HTMLDivElement>) {
    // intentionally empty
  }

  return (
    <div
      role="gridcell"
      data-lead-id={lead.id}
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={`${displayName(lead)} – ${STATUS_LABEL[status]}`}
      onClick={onSelectToggle}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex flex-col bg-surface border border-line rounded-squircle-sm overflow-hidden cursor-pointer transition-all duration-150",
        "before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:content-['']",
        severityTopBorder[sev],
        "hover:shadow-card hover:-translate-y-0.5",
        selected && "ring-2 ring-brand ring-offset-1 ring-offset-surface-soft",
        focused && !selected && "ring-2 ring-brand ring-offset-1 ring-offset-surface-soft outline-none",
        focused && selected && "ring-offset-2",
        lead.removedAt && "opacity-50",
      )}
    >
      {/* Bild-Bereich (16:9) */}
      <div className="relative aspect-video bg-surface-muted overflow-hidden">
        {showSkeleton ? (
          <div className="absolute inset-0 bg-gradient-to-br from-surface-muted via-line-soft to-surface-muted animate-pulse" />
        ) : showSpinner ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-muted">
            <Loader2 className="size-5 text-brand animate-spin" />
            <span className="text-[11px] font-medium text-ink-muted">Lädt…</span>
          </div>
        ) : hasScreenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.preflightScreenshotUrl ?? undefined}
            alt={`Webseite von ${displayDomain(lead)}`}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          // Terminal-Status ohne Screenshot. Inhalt + Retry-Sichtbarkeit
          // hängen am genauen Status — nicht jeder Fehler verdient den
          // Tonfall "Bitte erneut versuchen" (URL ist tot → kein Retry).
          <FallbackBody
            status={status}
            onRetryScreenshot={onRetryScreenshot}
            errorMessage={lead.preflightErrorMessage}
          />
        )}

        {/* Status-Pill (nur bei Problem / nicht-ok) */}
        {sev !== "ok" && sev !== "neutral" && (
          <div className="absolute top-2 left-2">
            <Badge
              variant={severityBadgeVariant[sev]}
              dot
              className="shadow-card backdrop-blur-sm bg-opacity-95"
            >
              {STATUS_LABEL[status]}
            </Badge>
          </div>
        )}
        {status === "running" && (
          <div className="absolute top-2 left-2">
            <Badge variant="brand" className="shadow-card">
              <Loader2 className="size-3 animate-spin" />
              Lädt…
            </Badge>
          </div>
        )}

        {/* Checkbox rechts-unten:
            - Problem-Karten: immer sichtbar
            - OK-Karten: nur on-hover bzw. wenn selected */}
        <div
          className={cn(
            "absolute bottom-2 right-2 z-10 transition-opacity duration-150",
            problematic || selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            role="presentation"
            className="flex items-center justify-center size-7 rounded-md bg-surface/95 shadow-card backdrop-blur-sm border border-line/80"
          >
            <Checkbox
              checked={selected}
              onClick={(e) => {
                e.stopPropagation();
                onSelectToggle(e);
              }}
              aria-label={selected ? "Auswahl aufheben" : "Lead markieren"}
            />
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-0.5 px-3 py-2.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-ink truncate">
            {displayName(lead)}
          </span>
          {displayCompany(lead) !== "—" && (
            <>
              <span className="text-ink-muted text-xs shrink-0">·</span>
              <span className="text-sm text-ink-soft truncate min-w-0">
                {displayCompany(lead)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted tabular-nums">
          <span className="truncate">{displayDomain(lead)}</span>
          {lead.preflightDurationMs !== null && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">
                {displayDuration(lead.preflightDurationMs)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inhalt + Tonfall des Fallback-Bildbereichs sind status-spezifisch.
 * Nur `screenshot_unavailable` lädt zum Retry ein — andere Fehler haben
 * eine eindeutige Ursache (URL tot, TLS-Cert kaputt, Bot-Block), bei der
 * ein Retry praktisch nichts ändert.
 */
function FallbackBody({
  status,
  errorMessage,
  onRetryScreenshot,
}: {
  status: PreflightStatus;
  errorMessage: string | null;
  onRetryScreenshot: () => void;
}) {
  const config = (() => {
    switch (status) {
      case "url_dead":
        return {
          title: "Webseite nicht erreichbar",
          sub: errorMessage ?? "Die URL liefert keine Antwort.",
          retry: false,
        };
      case "tls_error":
        return {
          title: "TLS-Zertifikat ungültig",
          sub: errorMessage ?? "HTTPS-Verbindung fehlgeschlagen.",
          retry: false,
        };
      case "url_redirect":
        return {
          title: "Weiterleitung erkannt",
          sub: errorMessage ?? "Domain leitet auf andere Seite um.",
          retry: false,
        };
      case "bot_block":
        return {
          title: "Bot-Schutz aktiv",
          sub: errorMessage ?? "Webseite blockiert automatisierte Zugriffe.",
          retry: false,
        };
      case "slow":
        return {
          title: "Webseite zu langsam",
          sub: errorMessage ?? "Ladezeit über 8 Sekunden.",
          retry: false,
        };
      case "missing_field":
        return {
          title: "Daten unvollständig",
          sub: errorMessage ?? "Pflichtfelder fehlen oder URL kaputt.",
          retry: false,
        };
      case "duplicate":
        return {
          title: "Duplikat",
          sub: "Diese Person wurde bereits in dieser Liste gefunden.",
          retry: false,
        };
      case "screenshot_unavailable":
        return {
          title: "Screenshot fehlgeschlagen",
          sub: errorMessage ?? null,
          retry: true,
        };
      default:
        return {
          title: "Unbekannter Fehler",
          sub: errorMessage ?? null,
          retry: false,
        };
    }
  })();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-surface-muted">
      <AlertTriangle className="size-5 text-warn" />
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-ink leading-tight">
          {config.title}
        </div>
        {config.sub && (
          <div className="text-[10px] text-ink-muted leading-tight line-clamp-2 max-w-[180px]">
            {config.sub}
          </div>
        )}
      </div>
      {config.retry && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetryScreenshot();
          }}
          aria-label="Screenshot erneut versuchen"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep hover:text-brand-800 transition-colors"
        >
          <RotateCcw className="size-3" />
          Neu versuchen
        </button>
      )}
    </div>
  );
}

export const LeadCard = React.memo(LeadCardImpl, (prev, next) => {
  return (
    prev.selected === next.selected &&
    prev.focused === next.focused &&
    prev.lead === next.lead &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onSelectToggle === next.onSelectToggle &&
    prev.onRetryScreenshot === next.onRetryScreenshot
  );
});
LeadCard.displayName = "LeadCard";
