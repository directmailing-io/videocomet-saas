"use client";

import * as React from "react";

/**
 * Shift-Klick-Bereichsauswahl für Tabellen: merkt sich den zuletzt
 * geklickten Anker und liefert bei Shift-Klick alle IDs dazwischen
 * (bezogen auf die aktuell sichtbare Reihenfolge).
 */
export function useShiftSelect() {
  const anchorRef = React.useRef<string | null>(null);

  const setAnchor = React.useCallback((id: string) => {
    anchorRef.current = id;
  }, []);

  const getRange = React.useCallback(
    (toId: string, visibleIds: string[]): string[] | null => {
      const anchor = anchorRef.current;
      if (!anchor || anchor === toId) return null;
      const a = visibleIds.indexOf(anchor);
      const b = visibleIds.indexOf(toId);
      if (a === -1 || b === -1) return null;
      const [start, end] = a < b ? [a, b] : [b, a];
      return visibleIds.slice(start, end + 1);
    },
    [],
  );

  return { setAnchor, getRange };
}
