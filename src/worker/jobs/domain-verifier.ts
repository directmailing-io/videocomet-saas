/**
 * Domain-Verifier-Job.
 *
 * Läuft im Worker-Prozess als simpler setInterval-Tick (kein BullMQ nötig —
 * die Last ist trivial: 5-7 Domains, 30s-Intervall, DNS-Lookups mit Timeout).
 *
 * Loop-Logik pro Tick:
 *  1. Hole alle Domains in Status pending / verifying / issuing_cert
 *  2. Pro Domain: DNS + TXT prüfen
 *  3. State-Maschine:
 *       pending      → verifying    (sofort beim ersten Tick)
 *       verifying    → issuing_cert (wenn DNS+TXT ok → Traefik-YAML schreiben)
 *       issuing_cert → active       (wenn Cert vorhanden / >30s nach YAML)
 *       *            → failed       (wenn >24h ohne Fortschritt)
 *  4. Log-Eintrag pro Check in domain_check_log
 *
 * Plus: Boot-Sync — sobald der Worker startet, schreiben wir Traefik-YAMLs
 * für alle aktiven Domains (idempotent), damit ein Container-Restart die
 * Configs garantiert wiederherstellt.
 *
 * Cert-Status-Prüfung: vereinfacht — sobald die YAML 30s alt ist und die
 * Domain via HTTPS antwortet, gilt der Cert als ausgestellt. Praezisere
 * Health-Prüfung kommt im separaten cert-health-monitor-Job.
 */

import {
  getDomainByIdAdmin,
  listActiveDomains,
  listDomainsByStatus,
  logDomainCheck,
  updateDomainStatus,
  type UserDomain,
} from "@/lib/db/queries/user-domains";
import { verifyDomain } from "@/lib/dns-verifier";
import {
  fileNameFor,
  listOwnedConfigs,
  readCertExpiry,
  removeTraefikConfig,
  syncTraefikConfigs,
  writeTraefikConfig,
} from "@/lib/traefik-writer";

const VERIFY_INTERVAL_MS = 30_000;
const FAIL_AFTER_HOURS = 24;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(`[domain-verifier] ${msg}`, extra);
  else fn(`[domain-verifier] ${msg}`);
}

/**
 * Eine einzelne Domain durch ihren Lifecycle pushen. Returnt true wenn der
 * State sich geändert hat (für Logging-Zwecke).
 */
async function tickDomain(d: UserDomain): Promise<void> {
  const v = await verifyDomain(d.hostname, d.verifyToken);
  await logDomainCheck(d.id, "dns", v.dnsOk, v.dnsMessage);
  await logDomainCheck(d.id, "txt", v.txtOk, v.txtMessage);

  const now = new Date();

  // 24h-Failure-Cap: wenn seit Erstellung 24h vergangen sind und immer
  // noch nicht ready → failed (mit klarer Begruendung).
  const ageMs = now.getTime() - d.createdAt.getTime();
  const ageHours = ageMs / 3_600_000;

  if (!v.ready) {
    if (ageHours >= FAIL_AFTER_HOURS && d.status !== "failed") {
      await updateDomainStatus(d.id, {
        status: "failed",
        lastCheckedAt: now,
        lastError: `Nach ${FAIL_AFTER_HOURS}h immer noch nicht verifiziert. DNS: ${v.dnsMessage ?? "?"}. TXT: ${v.txtMessage ?? "?"}.`,
      });
      log("warn", `domain ${d.hostname} failed after ${FAIL_AFTER_HOURS}h`);
      return;
    }
    // Noch im Verifying-Status halten, Last-Check + Last-Error aktualisieren.
    await updateDomainStatus(d.id, {
      status: d.status === "pending" ? "verifying" : d.status,
      lastCheckedAt: now,
      lastError: [v.dnsMessage, v.txtMessage].filter(Boolean).join(" | "),
    });
    return;
  }

  // DNS + TXT ok — nächster Schritt haengt vom aktuellen Status ab.
  if (d.status === "active") {
    // Re-Check eines aktiven — alles ok, nur lastCheckedAt updaten.
    await updateDomainStatus(d.id, { lastCheckedAt: now, lastError: null });
    return;
  }

  // Status pending / verifying / issuing_cert: YAML schreiben und auf
  // Cert warten. Idempotent.
  try {
    await writeTraefikConfig(d);
    await logDomainCheck(d.id, "cert", true, "Traefik-YAML geschrieben, Cert-Issuance gestartet.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    await updateDomainStatus(d.id, {
      status: "failed",
      lastCheckedAt: now,
      lastError: `Traefik-Config konnte nicht geschrieben werden: ${msg}`,
    });
    await logDomainCheck(d.id, "cert", false, msg);
    log("error", `failed to write Traefik config for ${d.hostname}: ${msg}`);
    return;
  }

  // Cert-Probe: wenn acme.json den Cert kennt, sind wir active.
  const expiry = await readCertExpiry(d.hostname).catch(() => null);
  if (expiry) {
    await updateDomainStatus(d.id, {
      status: "active",
      verifiedAt: d.verifiedAt ?? now,
      sslIssuedAt: now,
      sslExpiresAt: expiry,
      lastCheckedAt: now,
      lastError: null,
    });
    log("info", `domain ${d.hostname} → active (cert until ${expiry.toISOString()})`);
    return;
  }

  // Noch kein Cert — Status bleibt issuing_cert; Re-Check beim nächsten Tick.
  await updateDomainStatus(d.id, {
    status: "issuing_cert",
    verifiedAt: d.verifiedAt ?? now,
    lastCheckedAt: now,
    lastError: null,
  });
}

/**
 * Reconcile (seit 2026-09-02): Traefik-YAMLs, zu denen es keine Domain im
 * Status issuing_cert/active mehr gibt, werden entfernt. Das ersetzt die
 * frueheren Direkt-Loeschungen aus den API-Routen (Domain loeschen, Admin-
 * Reset) — der App-Container hat keinen Traefik-Zugriff mehr. Nur ein
 * readdir + Set-Vergleich pro Tick, keine Schreibvorgaenge im Normalfall.
 */
async function reconcileOrphanConfigs(): Promise<void> {
  const routed = await listDomainsByStatus(["issuing_cert", "active"]);
  const expected = new Set(routed.map((d) => fileNameFor(d.hostname)));
  const existing = await listOwnedConfigs();
  for (const file of existing) {
    if (expected.has(file)) continue;
    // Dateiname → Hostname ist nicht eindeutig rueckrechenbar, deshalb
    // ueber removeTraefikConfig mit dem rekonstruierten Namen gehen:
    // fileNameFor ist idempotent auf dem bereits "safen" Namen.
    const host = file.replace(/^vc-customdomain-/, "").replace(/\.yml$/, "");
    const removed = await removeTraefikConfig(host);
    log("info", `reconcile: removed orphan Traefik config ${file} (${removed ? "ok" : "already gone"})`);
  }
}

/**
 * Eine Iteration durch alle relevanten Domains.
 */
async function runVerifierTick(): Promise<void> {
  try {
    await reconcileOrphanConfigs();
  } catch (err) {
    log("warn", `reconcile skipped: ${(err as Error).message}`);
  }
  const pending = await listDomainsByStatus([
    "pending",
    "verifying",
    "issuing_cert",
  ]);
  if (pending.length === 0) return;
  log("info", `verifier tick: ${pending.length} domain(s) to check`);
  for (const d of pending) {
    try {
      await tickDomain(d);
    } catch (err) {
      log("error", `tick failed for ${d.hostname}: ${(err as Error).message}`);
    }
  }
}

/**
 * Boot-Sync: alle aktiven Domains haben garantiert eine YAML auf der Disk.
 * Verwaiste YAMLs (Domain im DB gelöscht) werden bereinigt.
 */
async function bootSync(): Promise<void> {
  const active = await listActiveDomains();
  try {
    const res = await syncTraefikConfigs(active);
    log(
      "info",
      `boot sync: wrote ${res.written} active config(s), removed ${res.removed} orphan(s), kept ${res.kept}`,
    );
  } catch (err) {
    log("error", `boot sync failed: ${(err as Error).message}`);
  }
}

/**
 * Public: Starte den Verifier-Loop. Wird vom worker/index.ts beim Boot
 * aufgerufen. Returnt eine stop()-Funktion für Graceful-Shutdown.
 */
export function startDomainVerifier(): () => void {
  void bootSync();
  void runVerifierTick();
  const t = setInterval(() => {
    runVerifierTick().catch((err) => log("error", "verifier tick crashed:", err));
  }, VERIFY_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}

/**
 * Public: einmaliger Force-Recheck einer Domain (vom API-Endpoint genutzt).
 * Returnt die aktualisierte Domain.
 */
export async function forceDomainRecheck(domainId: string): Promise<UserDomain | null> {
  const d = await getDomainByIdAdmin(domainId);
  if (!d) return null;
  await tickDomain(d);
  return getDomainByIdAdmin(domainId);
}

/**
 * Public: triggert ein Cleanup nach Domain-Loeschung. Wird vom DELETE-API
 * aufgerufen. Idempotent.
 */
export async function cleanupDeletedDomain(hostname: string): Promise<void> {
  try {
    await removeTraefikConfig(hostname);
    log("info", `cleanup: removed Traefik config for ${hostname}`);
  } catch (err) {
    log("warn", `cleanup failed for ${hostname}: ${(err as Error).message}`);
  }
}
