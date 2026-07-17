/**
 * Schicht 4b des Clean-Render-Systems: Host-Throttle.
 *
 * Der inuvet/fenou-Vorfall: 3 parallele Loads desselben Shopify-Hosts →
 * transiente "There was a problem loading this website"-Fehlerseiten.
 * Deshalb: maximal N gleichzeitige Page-Loads pro Hostname, plus ein
 * kleiner Jitter, damit Loads nicht im exakt selben Moment starten.
 *
 * Prozess-lokal (der Worker ist ein Einzelprozess) — kein Redis nötig.
 */

const MAX_CONCURRENT_PER_HOST = 2;
const JITTER_MAX_MS = 1_500;

type HostState = {
  active: number;
  queue: Array<() => void>;
};

const hosts = new Map<string, HostState>();

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "_invalid";
  }
}

/**
 * Reserviert einen Lade-Slot für den Host der URL. Blockiert, bis ein Slot
 * frei ist, und wartet danach einen zufälligen Jitter ab. Der zurückgegebene
 * Release MUSS (try/finally) gerufen werden.
 */
export async function acquireHostSlot(url: string): Promise<() => void> {
  const host = hostnameOf(url);
  let state = hosts.get(host);
  if (!state) {
    state = { active: 0, queue: [] };
    hosts.set(host, state);
  }

  if (state.active >= MAX_CONCURRENT_PER_HOST) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;

  // Jitter: parallele Starts entzerren.
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * JITTER_MAX_MS)));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active--;
    const next = state.queue.shift();
    if (next) next();
    if (state.active === 0 && state.queue.length === 0) hosts.delete(host);
  };
}
