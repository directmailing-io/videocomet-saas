/**
 * Session-Prune (Security-Härtung 2026-09-02).
 *
 * Lucia löscht abgelaufene Sessions nur lazy beim nächsten Zugriff mit
 * genau dieser Session-ID. Sessions von Nutzern, die nie wiederkommen,
 * blieben deshalb unbegrenzt in der Tabelle (älteste Einträge stammten
 * vom Juni 2026). Dieser Tick räumt alle `expires_at < now()` alle 6 h weg.
 * Reiner DB-Delete, keine Nebenwirkungen auf aktive Sitzungen.
 */

import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

const INTERVAL_MS = 6 * 60 * 60 * 1000;

async function pruneExpiredSessions(): Promise<void> {
  try {
    const deleted = await db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .returning({ id: sessions.id });
    if (deleted.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[session-prune] ${deleted.length} abgelaufene Session(s) entfernt`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[session-prune] fehlgeschlagen:", (err as Error).message);
  }
}

export function startSessionPrune(): () => void {
  void pruneExpiredSessions();
  const t = setInterval(() => void pruneExpiredSessions(), INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
