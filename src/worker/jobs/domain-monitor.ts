/**
 * Domain-Monitor: läuft alle 1h und macht zwei Dinge:
 *
 *  1. **Health-Check pro aktiver Domain** — HTTPS-Request auf die Custom-
 *     Domain (Pfad: /api/healthz). Wenn nicht erreichbar oder Cert ungueltig,
 *     wird das in `domain_check_log` festgehalten und (bei dauerhaftem
 *     Fehler) die Domain auf `failed` gesetzt.
 *
 *  2. **acme.json-Backup** — taeglich (nicht stuendlich) eine Kopie nach
 *     /opt/videocomet/backups/acme/ mit 30 Tage Retention. Sehr klein
 *     (KB-bereich), aber kritisch: ohne Backup können wir nach einem
 *     Cert-Storage-Verlust nicht innerhalb der Let's-Encrypt-Rate-Limits
 *     wiederherstellen.
 *
 * Beide Operationen sind Best-Effort — sie dürfen den Worker nie crashen.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  listActiveDomains,
  logDomainCheck,
  updateDomainStatus,
} from "@/lib/db/queries/user-domains";

const MONITOR_INTERVAL_MS = 60 * 60 * 1000; // 1h
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1d
const HEALTH_TIMEOUT_MS = 8_000;
const HEALTH_FAIL_THRESHOLD_HOURS = 4; // erst nach 4h durchgehender Fehler → failed
const BACKUP_RETENTION_DAYS = 30;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(`[domain-monitor] ${msg}`, extra);
  else fn(`[domain-monitor] ${msg}`);
}

// ── Health-Check ───────────────────────────────────────────────────────────

async function probeHttps(hostname: string): Promise<{ ok: boolean; status?: number; message: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${hostname}/api/healthz`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "videocomet-domain-monitor/1.0" },
      redirect: "manual",
    });
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      message: `HTTPS ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `HTTPS-Fehler: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(t);
  }
}

async function runHealthChecks(): Promise<void> {
  const active = await listActiveDomains();
  if (active.length === 0) return;
  log("info", `health-check: ${active.length} active domain(s)`);
  for (const d of active) {
    const res = await probeHttps(d.hostname);
    await logDomainCheck(d.id, "health", res.ok, res.message);
    if (res.ok) {
      await updateDomainStatus(d.id, { lastCheckedAt: new Date(), lastError: null });
      continue;
    }
    // Nicht erreichbar — Lebensdauer-Check: wenn der Domain seit
    // HEALTH_FAIL_THRESHOLD_HOURS keinen erfolgreichen Check mehr hatte,
    // markieren wir sie als failed. Vereinfachte Logik: wir nutzen
    // `lastCheckedAt` als Proxy — wenn der letzte erfolgreiche Check
    // >= Threshold zurückliegt, ziehen wir die Notbremse.
    const ageMs = d.lastCheckedAt ? Date.now() - d.lastCheckedAt.getTime() : 0;
    const ageHours = ageMs / 3_600_000;
    if (ageHours >= HEALTH_FAIL_THRESHOLD_HOURS) {
      await updateDomainStatus(d.id, {
        status: "failed",
        lastCheckedAt: new Date(),
        lastError: `Health-Check fehlgeschlagen seit >${HEALTH_FAIL_THRESHOLD_HOURS}h: ${res.message}`,
      });
      log("warn", `domain ${d.hostname} → failed (health gone for ${ageHours.toFixed(1)}h)`);
    } else {
      await updateDomainStatus(d.id, {
        lastCheckedAt: new Date(),
        lastError: res.message,
      });
    }
  }
}

// ── acme.json-Backup ───────────────────────────────────────────────────────

function getAcmePath(): string {
  // Default-Pfad wenn der Coolify-Proxy-Mount /traefik-dynamic ist, liegt
  // acme.json eine Ebene drüber.
  return process.env.TRAEFIK_ACME_PATH ?? "/traefik-dynamic/../acme.json";
}

function getBackupDir(): string {
  return process.env.ACME_BACKUP_DIR ?? "/opt/videocomet/backups/acme";
}

let lastBackupAt = 0;

async function maybeBackupAcme(): Promise<void> {
  if (Date.now() - lastBackupAt < BACKUP_INTERVAL_MS) return;

  const src = getAcmePath();
  const dir = getBackupDir();
  try {
    await fs.access(src);
  } catch {
    log("warn", `acme.json not found at ${src} — skipping backup`);
    lastBackupAt = Date.now();
    return;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    log("error", `cannot create backup dir ${dir}: ${(err as Error).message}`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const dst = join(dir, `acme-${stamp}.json`);
  try {
    await fs.copyFile(src, dst);
    log("info", `acme.json backed up to ${dst}`);
  } catch (err) {
    log("error", `acme.json backup failed: ${(err as Error).message}`);
    return;
  }

  // Retention: 30 Tage
  try {
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86_400_000;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.startsWith("acme-") || !f.endsWith(".json")) continue;
      const p = join(dir, f);
      const st = await fs.stat(p);
      if (st.mtimeMs < cutoff) {
        await fs.unlink(p);
      }
    }
  } catch (err) {
    log("warn", `acme backup retention cleanup failed: ${(err as Error).message}`);
  }

  lastBackupAt = Date.now();
}

// ── Tick ───────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  await runHealthChecks().catch((err) => log("error", "health-check failed:", err));
  await maybeBackupAcme().catch((err) => log("error", "acme backup failed:", err));
}

export function startDomainMonitor(): () => void {
  // Beim Boot: kein sofortiger Tick — der Verifier hat seine eigene Boot-
  // Sequenz, wir wollen ihn nicht überholen. Nach 5 min ersten Tick.
  const t = setTimeout(() => {
    void tick();
  }, 5 * 60 * 1000);
  const interval = setInterval(() => {
    tick().catch((err) => log("error", "monitor tick crashed:", err));
  }, MONITOR_INTERVAL_MS);
  interval.unref();
  return () => {
    clearTimeout(t);
    clearInterval(interval);
  };
}
