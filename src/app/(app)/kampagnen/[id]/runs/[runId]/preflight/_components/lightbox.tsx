"use client";

import * as React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  displayCompany,
  displayDomain,
  displayDuration,
  displayName,
  isProblematic,
  severityOf,
  STATUS_LABEL,
  type PreflightLead,
} from "./lead-card";
import { cn } from "@/lib/utils";

const severityBadgeVariant = {
  danger: "danger",
  warn: "warn",
  info: "neutral",
  ok: "success",
  neutral: "brand",
} as const;

export interface LightboxProps {
  open: boolean;
  leads: ReadonlyArray<PreflightLead>;
  activeLeadId: string | null;
  onChangeActive: (leadId: string) => void;
  onClose: () => void;
  onKeep: (leadId: string) => void;
  onReject: (leadId: string) => void;
  onRetryScreenshot: (leadId: string) => void;
}

/**
 * Lightbox-Detailansicht für eine einzelne Karte.
 *
 * Wir verwenden hier den Radix-Dialog-Primitive DIREKT (statt das
 * gestylte `DialogContent`-Preset von `@/components/ui/dialog`), weil
 * wir ein viel breiteres Layout (max-w 1080px), Padding 0 und einen
 * Side-by-Side-Split (60/40) brauchen — Konfiguration, die der
 * Default-Wrapper nicht zulässt.
 */
export function Lightbox({
  open,
  leads,
  activeLeadId,
  onChangeActive,
  onClose,
  onKeep,
  onReject,
  onRetryScreenshot,
}: LightboxProps) {
  const activeIdx = React.useMemo(
    () => leads.findIndex((l) => l.id === activeLeadId),
    [leads, activeLeadId],
  );
  const lead = activeIdx >= 0 ? leads[activeIdx] : null;

  const goPrev = React.useCallback(() => {
    if (activeIdx <= 0 || leads.length === 0) return;
    onChangeActive(leads[activeIdx - 1].id);
  }, [activeIdx, leads, onChangeActive]);

  const goNext = React.useCallback(() => {
    if (activeIdx < 0 || activeIdx >= leads.length - 1) return;
    onChangeActive(leads[activeIdx + 1].id);
  }, [activeIdx, leads, onChangeActive]);

  // Lightbox-spezifische ← / → — werden NICHT vom globalen Hook gefangen,
  // weil der globale Hook ArrowLeft/Right gar nicht registriert (Spec).
  // Statt dessen handeln wir hier on-content keydown.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(96vw,1080px)] -translate-x-1/2 -translate-y-1/2",
            "bg-surface rounded-squircle-xl border border-line shadow-lift overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Lead-Detail
          </DialogPrimitive.Title>
          {lead ? (
            <LightboxBody
              lead={lead}
              indexLabel={`Lead ${activeIdx + 1} / ${leads.length}`}
              canPrev={activeIdx > 0}
              canNext={activeIdx >= 0 && activeIdx < leads.length - 1}
              onPrev={goPrev}
              onNext={goNext}
              onClose={onClose}
              onKeep={() => onKeep(lead.id)}
              onReject={() => onReject(lead.id)}
              onRetryScreenshot={() => onRetryScreenshot(lead.id)}
            />
          ) : (
            <div className="flex items-center justify-center min-h-[320px] text-sm text-ink-muted">
              Kein Lead ausgewählt.
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface LightboxBodyProps {
  lead: PreflightLead;
  indexLabel: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onKeep: () => void;
  onReject: () => void;
  onRetryScreenshot: () => void;
}

function LightboxBody({
  lead,
  indexLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
  onKeep,
  onReject,
  onRetryScreenshot,
}: LightboxBodyProps) {
  const sev = severityOf(lead.preflightStatus);
  const hasScreenshot = Boolean(lead.preflightScreenshotUrl);
  const isPendingOrRunning =
    lead.preflightStatus === "pending" || lead.preflightStatus === "running";

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {indexLabel}
          </span>
          <Badge
            variant={severityBadgeVariant[sev]}
            dot
            className={sev === "neutral" ? "" : ""}
          >
            {STATUS_LABEL[lead.preflightStatus]}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canPrev}
            onClick={onPrev}
            aria-label="Vorheriger Lead"
            className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted hover:bg-line-soft hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={onNext}
            aria-label="Nächster Lead"
            className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted hover:bg-line-soft hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="ml-1 inline-flex items-center justify-center size-8 rounded-full text-ink-muted hover:bg-line-soft hover:text-ink transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] min-h-[440px]">
        {/* Left: Screenshot */}
        <div className="bg-surface-muted md:border-r border-line flex items-center justify-center p-5 md:p-6 md:min-h-[540px]">
          {isPendingOrRunning ? (
            <div className="flex flex-col items-center gap-2 text-ink-muted">
              <Loader2 className="size-6 animate-spin text-brand" />
              <span className="text-sm font-medium">Phase 1 läuft…</span>
            </div>
          ) : hasScreenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lead.preflightScreenshotUrl ?? undefined}
              alt={`Webseite von ${displayDomain(lead)}`}
              className="w-full max-w-[640px] aspect-video object-cover rounded-squircle-sm border border-line bg-surface shadow-card"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center max-w-sm">
              <Globe className="size-7 text-ink-muted" />
              <p className="text-sm font-semibold text-ink">
                Kein Screenshot verfügbar
              </p>
              <p className="text-xs text-ink-muted">
                Phase 1 hat für diesen Lead keinen Screenshot erzeugt. Sie
                können es erneut versuchen oder den Lead entfernen.
              </p>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<RotateCcw className="size-4" />}
                onClick={onRetryScreenshot}
              >
                Screenshot neu erzeugen
              </Button>
            </div>
          )}
        </div>

        {/* Right: Metadaten */}
        <div className="flex flex-col gap-4 p-5 md:p-6">
          <div>
            <h2 className="text-lg font-bold text-ink leading-tight">
              {displayName(lead)}
            </h2>
            <p className="text-sm text-ink-soft">{displayCompany(lead)}</p>
          </div>

          <MetaList>
            <MetaRow label="Original-URL" value={lead.websiteUrl ?? "—"} />
            {lead.preflightFinalUrl &&
              lead.preflightFinalUrl !== lead.websiteUrl && (
                <MetaRow
                  label="Final-URL"
                  value={lead.preflightFinalUrl}
                  hint={lead.preflightHttpStatus === 301 ? "(301)" : undefined}
                />
              )}
            <MetaRow
              label="HTTP-Status"
              value={
                lead.preflightHttpStatus !== null
                  ? String(lead.preflightHttpStatus)
                  : "—"
              }
            />
            <MetaRow
              label="Ladezeit"
              value={displayDuration(lead.preflightDurationMs)}
            />
            <MetaRow
              label="Versuche"
              value={String(lead.preflightAttempts)}
            />
            {lead.preflightErrorMessage && (
              <div className="mt-1 rounded-squircle-sm bg-danger/5 border border-danger/20 px-3 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-danger mb-1">
                  Fehler
                </div>
                <p className="text-xs text-ink-soft leading-relaxed break-words">
                  {lead.preflightErrorMessage}
                </p>
              </div>
            )}
          </MetaList>

          {/* Actions */}
          <div className="mt-auto pt-4 border-t border-line flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="brand"
                size="sm"
                iconLeft={<Check className="size-4" />}
                onClick={onKeep}
                className="flex-1 min-w-[120px]"
              >
                Behalten
              </Button>
              <Button
                variant="danger"
                size="sm"
                iconLeft={<Trash2 className="size-4" />}
                onClick={onReject}
                className="flex-1 min-w-[120px]"
              >
                Entfernen
              </Button>
            </div>
            {lead.websiteUrl && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                iconLeft={<ExternalLink className="size-4" />}
              >
                <a
                  href={lead.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Original öffnen
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaList({ children }: { children: React.ReactNode }) {
  return <dl className="flex flex-col gap-2.5 text-sm">{children}</dl>;
}

function MetaRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 items-baseline">
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className="text-sm text-ink break-all">
        {value}
        {hint && (
          <span className="ml-1.5 text-xs text-ink-muted">{hint}</span>
        )}
      </dd>
    </div>
  );
}
