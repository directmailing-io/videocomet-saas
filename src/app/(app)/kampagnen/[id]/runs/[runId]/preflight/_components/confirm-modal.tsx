"use client";

import * as React from "react";
import { Play, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  isProblematic,
  severityOf,
  STATUS_LABEL,
  type PreflightLead,
  type PreflightStatus,
} from "./lead-card";

/**
 * Confirm-Modal für „Vollproduktion starten".
 *
 * Zeigt eine kompakte Breakdown-Übersicht: wie viele Leads werden in
 * Phase 2 geschickt, wie viele wurden aussortiert (mit Aufgliederung
 * nach Status). Die eigentliche API-Call macht der Caller — wir geben
 * lediglich `onConfirm` zurück.
 */
export interface ConfirmModalProps {
  open: boolean;
  loading: boolean;
  leads: ReadonlyArray<PreflightLead>;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  loading,
  leads,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  // Aktive (nicht entfernte) Leads zählen, dann nach Status gruppieren.
  const summary = React.useMemo(() => {
    const active = leads.filter((l) => !l.removedAt);
    const removed = leads.filter((l) => l.removedAt);
    const okCount = active.filter((l) => l.preflightStatus === "ok").length;
    const stillProblematic = active.filter((l) =>
      isProblematic(l.preflightStatus),
    );
    const pendingCount = active.filter(
      (l) =>
        l.preflightStatus === "pending" || l.preflightStatus === "running",
    ).length;

    const byStatus: Partial<Record<PreflightStatus, number>> = {};
    for (const l of removed) {
      const s = l.preflightStatus;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    for (const l of stillProblematic) {
      const s = l.preflightStatus;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    const targetCount = okCount + stillProblematic.length;

    return {
      activeCount: active.length,
      removedCount: removed.length,
      okCount,
      stillProblematicCount: stillProblematic.length,
      pendingCount,
      byStatus,
      targetCount,
    };
  }, [leads]);

  // Grobe Schätzung — diese Zahlen sind Platzhalter, weil wir die
  // tatsächlichen Compute-Kosten erst beim Render-Worker kennen. Format
  // bleibt absichtlich verbal („~ 8 Min Dauer").
  const estDurationMin = Math.max(1, Math.round(summary.targetCount * 0.08));
  const estStorageGB = Math.max(0.5, +(summary.targetCount * 0.012).toFixed(1));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onCancel();
      }}
    >
      <DialogContent size="xl" showClose={!loading} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Vollproduktion starten</DialogTitle>
          <DialogDescription>
            Sie starten die Phase-2-Pipeline für die behaltenen Leads. Die
            entfernten Leads bleiben als Soft-Delete erhalten, werden aber
            nicht produziert.
          </DialogDescription>
        </DialogHeader>

        {/* Stats-Row */}
        <div className="grid grid-cols-3 gap-3 mt-1">
          <SummaryStat
            label="Werden produziert"
            value={summary.targetCount}
            tone="brand"
          />
          <SummaryStat
            label="Entfernt"
            value={summary.removedCount}
            tone="muted"
          />
          <SummaryStat
            label="Geschätzte Dauer"
            value={`~ ${estDurationMin} Min`}
            tone="muted"
            small
          />
        </div>

        {summary.pendingCount > 0 && (
          <div className="flex items-start gap-2.5 mt-2 px-3 py-2.5 bg-warn-soft border border-warn/30 rounded-squircle-sm text-warn">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              <span className="font-semibold">Hinweis:</span>{" "}
              {summary.pendingCount} Lead{summary.pendingCount === 1 ? "" : "s"}{" "}
              wird in Phase 1 noch geprüft. Diese werden bei Start in den
              aktuellen Zustand übernommen.
            </p>
          </div>
        )}

        {Object.keys(summary.byStatus).length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Aufgliederung
            </div>
            <ul className="flex flex-col gap-1.5">
              {(Object.keys(summary.byStatus) as PreflightStatus[]).map((s) => {
                const sev = severityOf(s);
                const n = summary.byStatus[s] ?? 0;
                return (
                  <li
                    key={s}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          sev === "danger"
                            ? "danger"
                            : sev === "warn"
                              ? "warn"
                              : "neutral"
                        }
                        dot
                      >
                        {STATUS_LABEL[s]}
                      </Badge>
                    </div>
                    <span className="tabular-nums font-semibold text-ink">
                      {n}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-2 text-xs text-ink-muted">
          Geschätzter Bunny-Storage-Verbrauch: ~ {estStorageGB} GB
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Abbrechen
          </Button>
          <Button
            variant="brand"
            iconLeft={<Play className="size-4" />}
            loading={loading}
            onClick={onConfirm}
            disabled={summary.targetCount === 0}
          >
            Produktion starten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: number | string;
  tone: "brand" | "muted";
  small?: boolean;
}) {
  return (
    <div
      className={
        tone === "brand"
          ? "rounded-squircle-sm border border-brand/30 bg-brand-soft px-3 py-2.5"
          : "rounded-squircle-sm border border-line bg-surface-soft px-3 py-2.5"
      }
    >
      <div
        className={
          tone === "brand"
            ? "text-brand-deep text-xl font-bold leading-tight tabular-nums"
            : small
              ? "text-ink text-sm font-semibold leading-tight tabular-nums"
              : "text-ink text-xl font-bold leading-tight tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mt-0.5">
        {label}
      </div>
    </div>
  );
}
