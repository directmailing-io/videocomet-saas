"use client";

import * as React from "react";

/**
 * Hook: useKeyboardShortcuts
 *
 * Registriert genau EINEN window-keydown-Listener und routet
 * Tasten-Kombinationen zu Handlern aus der `handlers`-Map. Wir lassen
 * Shortcuts NICHT feuern, wenn der Fokus in einem Input/Textarea liegt
 * (Suche etc.) — Ausnahme: Escape, das den Fokus aus dem Suchfeld
 * herausziehen darf.
 *
 * Key-Format (Map-Keys):
 *   "Space"             — Leertaste
 *   "Enter"             — Enter / Return
 *   "Escape"            — Esc
 *   "ArrowLeft" / "ArrowRight"
 *   "/"                 — Slash
 *   "r" | "k" | "f"     — Buchstaben (case-insensitiv)
 *   "Mod+a"             — Cmd+A (macOS) ODER Ctrl+A (Win/Linux)
 *
 * Handlers können `event.preventDefault()` implizit erwarten — wir rufen
 * preventDefault auf, sobald wir matchen, damit Browser-Defaults
 * (z.B. Cmd+A markiert die ganze Page) unterbunden werden.
 */

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler | undefined>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function normalizeKey(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey;
  // Modifier-Combos vor regulären Keys prüfen.
  if (mod && (e.key === "a" || e.key === "A")) return "Mod+a";

  // Reguläre, namentliche Keys 1:1.
  if (
    e.key === "Escape" ||
    e.key === "Enter" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "ArrowUp" ||
    e.key === "ArrowDown"
  ) {
    return e.key;
  }
  if (e.code === "Space" || e.key === " ") return "Space";
  if (e.key === "/") return "/";

  // Buchstaben-Shortcuts: nur ohne Modifier, sonst kollidiert es mit
  // Browser-Shortcuts wie Cmd+R (Reload).
  if (!mod && /^[a-zA-Z]$/.test(e.key)) {
    return e.key.toLowerCase();
  }
  return null;
}

export function useKeyboardShortcuts(handlers: ShortcutMap): void {
  // Ref auf den jüngsten Handler-Snapshot — vermeidet, dass jedes
  // Re-Mount neu am window registriert.
  const handlersRef = React.useRef<ShortcutMap>(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = normalizeKey(e);
      if (!key) return;

      const editable = isEditableTarget(e.target);
      // In Eingabefeldern lassen wir NUR Escape durch.
      if (editable && key !== "Escape") return;

      const handler = handlersRef.current[key];
      if (!handler) return;

      e.preventDefault();
      handler(e);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
