/**
 * Reine Berechnung des Drop-Ziel-Index für den Timeline-Reorder.
 *
 * Ansatz: Beim Zeiger-Move wird geprüft, in welchem Segment die Maus
 * gerade steht — das drag-Segment wird nach dem Center-Punkt des
 * Ziel-Segments einsortiert (links davon → davor, rechts davon → dahinter).
 * Positionen sind relativ zum Track-Container (`leftPx` + `widthPx` pro
 * Segment). Der Aufrufer sammelt sie einmalig aus `blocks`.
 *
 * Unit-getestet, damit der Timeline-Code selbst frei von Randfall-Logik
 * bleibt (letztes Segment, Position vor Segment 0, gleicher Index).
 */

export interface BlockPos {
  id: string;
  leftPx: number;
  widthPx: number;
}

/**
 * Ermittelt den Ziel-Insert-Index innerhalb der aktuellen Segment-Reihe
 * für einen Drag. `blocks` MUSS in Segment-Reihenfolge sortiert sein.
 *
 * Rückgabe ist der Index, an dem das gezogene Segment nach dem Entfernen
 * aus seiner alten Position wieder eingesetzt wird — kompatibel mit
 * `splice(targetIndex, 0, ...)`. Kein Move → gleicher Index wie vorher.
 */
export function computeReorderTargetIndex(
  blocks: readonly BlockPos[],
  draggingId: string,
  pointerXPx: number,
): number {
  const from = blocks.findIndex((b) => b.id === draggingId);
  if (from < 0) return -1;

  // Vor dem ersten Block → Index 0
  if (pointerXPx <= blocks[0].leftPx) {
    return 0 <= from ? 0 : 0;
  }
  const last = blocks[blocks.length - 1];
  if (pointerXPx >= last.leftPx + last.widthPx) {
    return blocks.length - 1;
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const center = b.leftPx + b.widthPx / 2;
    if (pointerXPx < center) {
      // vor Block i → Ziel-Index i (vor der Entfernung); nach Entfernung
      // muss um 1 reduziert werden, wenn from < i.
      return from < i ? i - 1 : i;
    }
  }
  // Fallback: hinter allen → letzter Index
  return blocks.length - 1;
}
