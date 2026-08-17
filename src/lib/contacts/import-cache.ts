/**
 * In-Memory Parse-Snapshot-Cache für den zweistufigen Kontakt-Import.
 * Der Parse-Snapshot lebt zwischen dem Preview-Endpoint (POST /import) und
 * dem Apply-Endpoint (POST /import/apply). Für Multi-Instance kommt später
 * Redis oder Bunny Storage rein.
 *
 * TTL 30 min. Nach jedem Zugriff wird der Cache aufgeräumt.
 */

export interface ParseSnapshot {
  userId: string;
  listId: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  createdAt: number;
}

const PARSE_TTL_MS = 30 * 60 * 1000;
const parseCache = new Map<string, ParseSnapshot>();

function prune(): void {
  const now = Date.now();
  const stale: string[] = [];
  parseCache.forEach((snap, id) => {
    if (now - snap.createdAt > PARSE_TTL_MS) stale.push(id);
  });
  for (const id of stale) parseCache.delete(id);
}

export function saveParseSnapshot(id: string, snap: ParseSnapshot): void {
  prune();
  parseCache.set(id, snap);
}

export function getParseSnapshot(id: string): ParseSnapshot | undefined {
  prune();
  return parseCache.get(id);
}

export function deleteParseSnapshot(id: string): void {
  parseCache.delete(id);
}
