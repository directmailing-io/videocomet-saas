"use client";

/**
 * Update-Prompt-Dialog: "Auch alte Runden updaten?"
 *
 * Wird gezeigt, nachdem der Kunde eine neue Version hochgeladen hat UND die
 * API `affectedRuns` mit Länge > 0 zurückgegeben hat (oder nachdem er aus der
 * Versions-Liste "Aktivieren" gedrückt hat).
 *
 * Drei Modi (Radio):
 *   1. "Nur künftige Runden bekommen die neue Version"   → Default
 *   2. "Alle Runden auf die neue Version aktualisieren"  → repinRunIds: alle
 *   3. "Bestimmte Runden auswählen"                      → Checkbox-Liste
 *
 * Confirm → POST /api/custom-lp/[id]/versions/[vid]/activate { repinRunIds }.
 * Es ist Aufgabe des Parents, den HTTP-Request abzusetzen — wir liefern nur
 * die `repinRunIds`.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AffectedRunRow {
  runId: string;
  runName: string;
  campaignName: string;
  /** Optional: aktuell gepinnte Version (für Anzeige). */
  pinnedVersionNumber?: number;
}

interface UpdatePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Versions-Nummer der NEU hochgeladenen Version, für die Headline. */
  newVersionNumber: number;
  affectedRuns: AffectedRunRow[];
  submitting?: boolean;
  /** Wird mit der finalen Liste von Run-IDs (zum Repin) gerufen. */
  onConfirm: (repinRunIds: string[]) => void;
}

type Mode = "future_only" | "all" | "select";

export function UpdatePromptDialog({
  open,
  onOpenChange,
  newVersionNumber,
  affectedRuns,
  submitting,
  onConfirm,
}: UpdatePromptDialogProps) {
  const [mode, setMode] = React.useState<Mode>("future_only");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Reset state when dialog opens (sodass alte Auswahl nicht klebt)
  React.useEffect(() => {
    if (open) {
      setMode("future_only");
      setSelected(new Set());
    }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    if (mode === "future_only") {
      onConfirm([]);
    } else if (mode === "all") {
      onConfirm(affectedRuns.map((r) => r.runId));
    } else {
      onConfirm(Array.from(selected));
    }
  }

  const selectAll = () => setSelected(new Set(affectedRuns.map((r) => r.runId)));
  const selectNone = () => setSelected(new Set());

  const confirmDisabled =
    submitting || (mode === "select" && selected.size === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            Neue Version (v{newVersionNumber}) — auch alte Runden updaten?
          </DialogTitle>
          <DialogDescription>
            Es gibt{" "}
            <span className="font-semibold text-ink">{affectedRuns.length}</span>{" "}
            laufende{" "}
            {affectedRuns.length === 1 ? "Runde" : "Runden"}, die diese Vorlage
            nutzen. Wie möchten Sie verfahren?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <RadioRow
            checked={mode === "future_only"}
            onSelect={() => setMode("future_only")}
            title="Nur künftige Runden bekommen die neue Version"
            description="Bestehende Runden bleiben auf ihrer gepinnten Version. Empfohlen, wenn die Änderung breaking ist."
          />
          <RadioRow
            checked={mode === "all"}
            onSelect={() => setMode("all")}
            title={`Alle ${affectedRuns.length} ${
              affectedRuns.length === 1 ? "Runde" : "Runden"
            } auf v${newVersionNumber} aktualisieren`}
            description="Repinnt alle betroffenen Runden auf die neue Version. Vorhandene Lead-URLs bleiben gleich."
          />
          <RadioRow
            checked={mode === "select"}
            onSelect={() => setMode("select")}
            title="Bestimmte Runden auswählen"
            description="Sie wählen pro Runde, ob sie auf die neue Version gepinnt wird."
          />

          {mode === "select" && (
            <div className="mt-2 rounded-squircle-md border border-line bg-surface-muted/40">
              <div className="flex items-center justify-between px-4 py-2 border-b border-line">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Runden ({selected.size} / {affectedRuns.length} gewählt)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs font-medium text-brand-deep hover:underline"
                  >
                    Alle
                  </button>
                  <span className="text-ink-muted">·</span>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="text-xs font-medium text-ink-muted hover:underline"
                  >
                    Keine
                  </button>
                </div>
              </div>
              <ul className="max-h-72 overflow-y-auto divide-y divide-line">
                {affectedRuns.map((r) => {
                  const checked = selected.has(r.runId);
                  return (
                    <li key={r.runId}>
                      <label
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-surface",
                          checked && "bg-brand-soft/30",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(r.runId)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink truncate">
                            {r.runName}
                          </p>
                          <p className="text-xs text-ink-muted truncate">
                            {r.campaignName}
                          </p>
                        </div>
                        {typeof r.pinnedVersionNumber === "number" && (
                          <Badge variant="neutral">
                            v{r.pinnedVersionNumber}
                          </Badge>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Abbrechen
          </Button>
          <Button
            onClick={confirm}
            disabled={confirmDisabled}
            loading={submitting}
          >
            {mode === "future_only"
              ? "Nur künftige verwenden"
              : mode === "all"
                ? `Alle ${affectedRuns.length} aktualisieren`
                : `${selected.size} aktualisieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────

function RadioRow({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-squircle-md border bg-surface p-3 transition-all",
        checked
          ? "border-brand ring-2 ring-brand/20"
          : "border-line hover:border-brand/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            checked ? "border-brand bg-brand" : "border-line",
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-white" />}
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}
