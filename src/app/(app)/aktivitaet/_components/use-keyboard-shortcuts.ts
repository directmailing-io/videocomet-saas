"use client";

import * as React from "react";

/**
 * Hook: useKeyboardShortcuts (Activity-Center-Variante)
 *
 * Eigenständige Mini-Implementierung — die preflight-Variante deckt
 * unsere Tasten (↑/↓, Enter, Esc, Cmd+E, /, 1-5, ?) zwar fast komplett
 * ab, exportiert aber andere semantische Keys. Wir spiegeln deren API
 * (ShortcutMap als Key→Handler-Map) und ergänzen Ziffern-Shortcuts.
 *
 * Key-Format:
 *   "Enter" | "Escape"
 *   "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
 *   "/" | "?" | "1" | "2" | "3" | "4" | "5"
 *   "Mod+e"  (Cmd+E auf macOS, Ctrl+E sonst)
 *
 * In Eingabefeldern (Input/Textarea/contentEditable) lassen wir nur
 * Escape passieren, damit z.B. das Suchfeld nicht jeden Tastendruck
 * abgefangen bekommt.
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
  if (mod && (e.key === "e" || e.key === "E")) return "Mod+e";

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
  if (e.key === "/") return "/";
  if (e.key === "?") return "?";
  if (!mod && /^[1-5]$/.test(e.key)) return e.key;
  return null;
}

export function useKeyboardShortcuts(handlers: ShortcutMap): void {
  const handlersRef = React.useRef<ShortcutMap>(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = normalizeKey(e);
      if (!key) return;

      if (isEditableTarget(e.target) && key !== "Escape") return;

      const handler = handlersRef.current[key];
      if (!handler) return;

      e.preventDefault();
      handler(e);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
