"use client";

import * as React from "react";

/**
 * Hook: useSelection
 *
 * Verwaltet eine Set-basierte Auswahl von Lead-IDs für das Pre-Flight-Grid.
 * Unterstützt:
 *   - toggle / add / remove / clear
 *   - selectRange(fromId, toId, visibleList) — Shift-Click-Semantik
 *   - lastClickedId-State-Machine für „Shift+Click vom letzten Anker bis hier"
 *   - localStorage-Persistenz pro runId (key: vc-preflight-selection-${runId}),
 *     mit 24h-TTL — ältere Auswahlen werden beim Mount verworfen
 *
 * Wir verwenden bewusst KEIN `Set` im React-State, sondern halten den
 * State als Array (für stabile Re-Renders) und materialisieren das Set
 * lazy. Das vermeidet referenz-stabile Identity-Bugs (`new Set(prev)`-
 * Pattern zwingt jeden Subscriber zu re-rendern, auch wenn Inhalt gleich).
 */

interface PersistedSelection {
  ids: string[];
  storedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(runId: string): string {
  return `vc-preflight-selection-${runId}`;
}

function readFromStorage(runId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(runId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedSelection;
    if (!parsed || !Array.isArray(parsed.ids)) return [];
    if (Date.now() - parsed.storedAt > TTL_MS) {
      window.localStorage.removeItem(storageKey(runId));
      return [];
    }
    return parsed.ids;
  } catch {
    return [];
  }
}

function writeToStorage(runId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.length === 0) {
      window.localStorage.removeItem(storageKey(runId));
      return;
    }
    const payload: PersistedSelection = { ids, storedAt: Date.now() };
    window.localStorage.setItem(storageKey(runId), JSON.stringify(payload));
  } catch {
    // localStorage voll oder Privacy-Modus → graceful no-op
  }
}

export interface UseSelectionResult {
  selected: Set<string>;
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  add: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  replace: (ids: string[]) => void;
  clear: () => void;
  selectRange: (
    toId: string,
    visibleList: ReadonlyArray<string>,
    fromIdOverride?: string,
  ) => void;
  /**
   * Letzte Click-ID merken — Maus-Layer ruft das bei jedem regulären
   * Card-Click auf, damit Shift-Click die Ankerposition findet.
   */
  setAnchor: (id: string) => void;
}

export function useSelection(runId: string): UseSelectionResult {
  const [ids, setIds] = React.useState<string[]>(() => readFromStorage(runId));
  const anchorRef = React.useRef<string | null>(null);

  // Persistenz: bei jeder Änderung in localStorage spiegeln.
  React.useEffect(() => {
    writeToStorage(runId, ids);
  }, [runId, ids]);

  const selected = React.useMemo(() => new Set(ids), [ids]);

  const isSelected = React.useCallback(
    (id: string) => selected.has(id),
    [selected],
  );

  const toggle = React.useCallback((id: string) => {
    setIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    anchorRef.current = id;
  }, []);

  const add = React.useCallback((newIds: string[]) => {
    if (newIds.length === 0) return;
    setIds((prev) => {
      const set = new Set(prev);
      for (const id of newIds) set.add(id);
      return Array.from(set);
    });
  }, []);

  const remove = React.useCallback((removeIds: string[]) => {
    if (removeIds.length === 0) return;
    const removeSet = new Set(removeIds);
    setIds((prev) => prev.filter((id) => !removeSet.has(id)));
  }, []);

  const replace = React.useCallback((nextIds: string[]) => {
    setIds(Array.from(new Set(nextIds)));
  }, []);

  const clear = React.useCallback(() => {
    setIds([]);
    anchorRef.current = null;
  }, []);

  const selectRange = React.useCallback(
    (
      toId: string,
      visibleList: ReadonlyArray<string>,
      fromIdOverride?: string,
    ) => {
      const fromId = fromIdOverride ?? anchorRef.current ?? toId;
      const fromIdx = visibleList.indexOf(fromId);
      const toIdx = visibleList.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) {
        // Anker ist nicht (mehr) sichtbar — degradiert zu Einzel-Toggle.
        setIds((prev) =>
          prev.includes(toId) ? prev.filter((x) => x !== toId) : [...prev, toId],
        );
        anchorRef.current = toId;
        return;
      }
      const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      const range = visibleList.slice(lo, hi + 1);
      setIds((prev) => {
        const set = new Set(prev);
        for (const id of range) set.add(id);
        return Array.from(set);
      });
      anchorRef.current = toId;
    },
    [],
  );

  const setAnchor = React.useCallback((id: string) => {
    anchorRef.current = id;
  }, []);

  return {
    selected,
    selectedCount: ids.length,
    isSelected,
    toggle,
    add,
    remove,
    replace,
    clear,
    selectRange,
    setAnchor,
  };
}
