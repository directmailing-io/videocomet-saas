/**
 * App-seitiger Lese-Zugriff auf den Run-ETA-Cache (W3). Der Worker schreibt
 * alle ~12 s nach Redis (`eta:run:<runId>`, siehe worker/lib/run-eta.ts);
 * hier wird nur gelesen — nie berechnet, nie geblockt.
 */

import { getRedisConnection } from "@/worker/queue";
import type { RunEtaEntry } from "@/lib/run-eta-format";

function parseEntry(raw: string | null): RunEtaEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunEtaEntry;
    return Number.isFinite(parsed.remainingMs) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getRunEta(runId: string): Promise<RunEtaEntry | null> {
  try {
    return parseEntry(await getRedisConnection().get(`eta:run:${runId}`));
  } catch {
    return null;
  }
}

export async function getRunEtas(
  runIds: string[],
): Promise<Map<string, RunEtaEntry>> {
  const result = new Map<string, RunEtaEntry>();
  if (runIds.length === 0) return result;
  try {
    const raws = await getRedisConnection().mget(
      runIds.map((id) => `eta:run:${id}`),
    );
    raws.forEach((raw, i) => {
      const entry = parseEntry(raw);
      if (entry) result.set(runIds[i], entry);
    });
  } catch {
    // Redis nicht erreichbar — UI zeigt einfach keine ETA.
  }
  return result;
}
