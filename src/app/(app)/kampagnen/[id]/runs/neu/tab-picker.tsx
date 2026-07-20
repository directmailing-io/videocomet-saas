"use client";

/**
 * Multi-Tab-Picker für Google-Sheets-URLs mit mehreren Untertabellen.
 *
 * Der User sieht alle Tabs, wählt per Checkbox welche als eigene Runde
 * verarbeitet werden sollen. Pre-check: der Tab dessen gid im URL-
 * Fragment stand (was der User beim Kopieren offen hatte).
 *
 * Keine Preview-Rows in dieser Ansicht — die kommen im nächsten Schritt.
 * Hier gehts nur um "welche Tabs?".
 */

import * as React from "react";
import { Check, EyeOff, FileSpreadsheet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SheetTabInfo {
  gid: number;
  title: string;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  isActive: boolean;
}

export interface SelectedTab {
  gid: number;
  title: string;
}

interface Props {
  spreadsheetTitle: string;
  tabs: SheetTabInfo[];
  onCancel: () => void;
  onContinue: (selected: SelectedTab[]) => void;
  loading?: boolean;
}

export function MultiTabPicker({
  spreadsheetTitle,
  tabs,
  onCancel,
  onContinue,
  loading,
}: Props) {
  // Default-Selection: nur der Tab der beim Kopieren offen war.
  // User kann per Master-Toggle "alle" wählen. Explizit NICHT alle vorwählen —
  // die Rechnung bei 40-Tab-Sheets wäre sonst brutal.
  const [selected, setSelected] = React.useState<Set<number>>(() => {
    const s = new Set<number>();
    const active = tabs.find((t) => t.isActive);
    if (active) s.add(active.gid);
    return s;
  });

  function toggle(gid: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  function toggleAll() {
    const eligible = tabs.filter((t) => !t.hidden);
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((t) => t.gid)));
    }
  }

  const selectedCount = selected.size;
  const totalRows = tabs
    .filter((t) => selected.has(t.gid))
    .reduce((sum, t) => sum + t.rowCount, 0);

  const canContinue = selectedCount > 0 && !loading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welche Tabs sollen rein?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-squircle-sm bg-brand-soft/50 px-4 py-3 text-sm text-brand-deep">
          <Info className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Ein Tab = eine Runde.</div>
            <div className="text-xs text-brand-deep/80 mt-0.5">
              Wähle welche Tabs von{" "}
              <strong>„{spreadsheetTitle}"</strong> als eigene Runde verarbeitet
              werden sollen. Für jeden Tab erstellen wir eine separate Runde
              mit demselben Setup — du machst den Wizard nur einmal.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-brand-deep hover:underline"
          >
            {selected.size === tabs.filter((t) => !t.hidden).length
              ? "Auswahl zurücksetzen"
              : "Alle sichtbaren auswählen"}
          </button>
          <span className="text-xs text-ink-muted">
            {selectedCount} von {tabs.length} ausgewählt
          </span>
        </div>

        <div className="rounded-squircle-md bg-surface-soft divide-y divide-line-soft overflow-hidden">
          {tabs.map((tab) => {
            const isSelected = selected.has(tab.gid);
            const isEmpty = tab.rowCount === 0;
            return (
              <button
                key={tab.gid}
                type="button"
                onClick={() => !isEmpty && toggle(tab.gid)}
                disabled={isEmpty}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  isSelected && "bg-brand-soft/50",
                  !isSelected && !isEmpty && "hover:bg-surface-muted",
                  isEmpty && "opacity-50 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded border-2 shrink-0 transition-colors",
                    isSelected
                      ? "bg-brand border-brand"
                      : "border-line bg-white",
                  )}
                >
                  {isSelected && (
                    <Check className="size-3 text-white" strokeWidth={3} />
                  )}
                </span>
                <FileSpreadsheet className="size-4 text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate flex items-center gap-2">
                    {tab.title}
                    {tab.isActive && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-deep bg-brand-soft rounded-full px-2 py-0.5">
                        offen
                      </span>
                    )}
                    {tab.hidden && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted bg-surface-muted rounded-full px-2 py-0.5">
                        <EyeOff className="size-2.5" />
                        ausgeblendet
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {isEmpty
                      ? "leer"
                      : `~${tab.rowCount.toLocaleString("de-DE")} Zeilen`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedCount > 0 && (
          <div className="rounded-squircle-sm bg-brand-soft/50 px-4 py-3 text-sm">
            <strong className="text-ink">{selectedCount} Runde{selectedCount === 1 ? "" : "n"}</strong>{" "}
            werden erstellt · zusammen ca.{" "}
            <strong className="text-ink">
              {totalRows.toLocaleString("de-DE")}
            </strong>{" "}
            Zeile{totalRows === 1 ? "" : "n"}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Zurück
          </Button>
          <Button
            onClick={() => {
              const chosen = tabs
                .filter((t) => selected.has(t.gid))
                .map((t) => ({ gid: t.gid, title: t.title }));
              onContinue(chosen);
            }}
            disabled={!canContinue}
            loading={loading}
          >
            Weiter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
