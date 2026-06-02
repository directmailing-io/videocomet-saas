"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: "T", label: "Zeitraum: Heute" },
  { key: "W", label: "Zeitraum: Letzte 7 Tage" },
  { key: "M", label: "Zeitraum: Letzte 30 Tage" },
  { key: "Q", label: "Zeitraum: Letzte 90 Tage" },
  { key: "E", label: "Export-Dialog öffnen" },
  { key: "?", label: "Diese Übersicht anzeigen" },
];

/**
 * `?` opens an overlay listing every analytics-keyboard-shortcut. The button
 * itself is also a clickable affordance for non-keyboard users.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Tastatur-Shortcuts (?)"
        aria-label="Tastatur-Shortcuts"
        className="px-2"
      >
        <Keyboard className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Tastatur-Shortcuts</DialogTitle>
            <DialogDescription>
              In Eingabefeldern werden Shortcuts ignoriert.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {SHORTCUTS.map((s) => (
              <li
                key={s.key}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-line-soft last:border-0"
              >
                <span className="text-sm text-ink">{s.label}</span>
                <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-squircle-sm border border-line bg-surface-soft text-xs font-semibold text-ink">
                  {s.key}
                </kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
