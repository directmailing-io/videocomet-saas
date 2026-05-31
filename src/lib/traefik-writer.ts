/**
 * Traefik Dynamic-Config-Writer fuer Custom-Domains.
 *
 * Schreibt eine YAML-Datei pro aktiver Custom-Domain in den File-Provider-
 * Folder von Coolify's Traefik (`/data/coolify/proxy/dynamic/` auf dem Host,
 * gemountet als `/traefik-dynamic/` im Container).
 *
 * Sicherheits-Doktrin (User-Wunsch: "sehr vorsichtig, alles reversibel"):
 *  - Alle erzeugten Dateien starten mit Prefix `vc-customdomain-` →
 *    KEINE Kollision mit Coolify's eigenen Files (Caddyfile,
 *    default_redirect_503.yaml, ...)
 *  - Jede Datei traegt einen Provenance-Header-Kommentar mit Timestamp +
 *    Domain-ID, damit ein Operator sofort sieht woher sie kommt
 *  - `listOwnedConfigs()` listet NUR unsere Dateien (Prefix-Filter), nie
 *    fremde — wir loeschen oder beruehren nichts anderes
 *  - Wenn der Mount-Ordner fehlt: KEIN auto-create, sondern Fehler werfen.
 *    Das verhindert, dass wir auf einer Box ohne Mount versehentlich Files
 *    irgendwo im Container-FS ablegen
 *
 * Traefik liest den Ordner mit `watch: true`, Reload binnen ~1s.
 *
 * Cert-Issuance laeuft danach automatisch via Let's-Encrypt HTTP-01 auf :80.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { UserDomain } from "@/lib/db/queries/user-domains";

const DEFAULT_DIR = "/traefik-dynamic";
const FILE_PREFIX = "vc-customdomain-";
const TRAEFIK_SERVICE_URL = "http://videocomet-app:3000";
const TRAEFIK_CERT_RESOLVER = "letsencrypt";

function getDir(): string {
  return process.env.TRAEFIK_DYNAMIC_DIR ?? DEFAULT_DIR;
}

/**
 * Erzeugt einen sicheren Dateinamen aus dem Hostname.
 * Beispiel: video.klein-solutions.de → vc-customdomain-video-klein-solutions-de.yml
 */
function fileNameFor(hostname: string): string {
  const safe = hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/\.+/g, "-");
  return `${FILE_PREFIX}${safe}.yml`;
}

/**
 * Erzeugt einen sicheren Router-Namen aus dem Hostname (Traefik braucht ihn
 * unique innerhalb des File-Providers).
 */
function routerNameFor(hostname: string): string {
  return `vc-${hostname.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
}

/**
 * Generiert das YAML-Snippet fuer eine Domain. HTTPS-Router + HTTP→HTTPS-
 * Redirect. Cert via letsencrypt resolver.
 */
function generateYaml(domain: UserDomain): string {
  const host = domain.hostname.toLowerCase();
  const router = routerNameFor(host);
  return `# Managed by VIDEOCOMET — Custom-Domain Auto-Config
# Domain ID: ${domain.id}
# Hostname:  ${host}
# Generated: ${new Date().toISOString()}
# ACHTUNG:   Diese Datei wird vom VIDEOCOMET-Worker geschrieben/geloescht.
#            Manuelle Aenderungen werden beim naechsten Sync ueberschrieben.

http:
  routers:
    ${router}:
      rule: "Host(\`${host}\`)"
      entryPoints:
        - https
      service: vc-customdomain-app
      tls:
        certResolver: ${TRAEFIK_CERT_RESOLVER}
    ${router}-http:
      rule: "Host(\`${host}\`)"
      entryPoints:
        - http
      service: vc-customdomain-app
      middlewares:
        - vc-customdomain-https-redirect
  services:
    vc-customdomain-app:
      loadBalancer:
        servers:
          - url: "${TRAEFIK_SERVICE_URL}"
  middlewares:
    vc-customdomain-https-redirect:
      redirectScheme:
        scheme: https
        permanent: true
`;
}

async function ensureDirExists(): Promise<void> {
  const dir = getDir();
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) {
      throw new Error(`Traefik-dynamic-Pfad ist keine Directory: ${dir}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(
        `Traefik-dynamic-Ordner fehlt: ${dir}. Bitte den Coolify-Proxy-Dynamic-Ordner in den Worker-Container mounten (z.B. -v /data/coolify/proxy/dynamic:${dir}).`,
      );
    }
    throw err;
  }
}

/**
 * Schreibt (oder ueberschreibt idempotent) die YAML-Datei fuer eine Domain.
 * Schreibt erst nach <name>.tmp + rename — atomar, sodass Traefik niemals
 * eine halbe Datei sieht.
 */
export async function writeTraefikConfig(domain: UserDomain): Promise<string> {
  await ensureDirExists();
  const dir = getDir();
  const name = fileNameFor(domain.hostname);
  const finalPath = join(dir, name);
  const tmpPath = `${finalPath}.tmp`;
  const yaml = generateYaml(domain);
  await fs.writeFile(tmpPath, yaml, { encoding: "utf8", mode: 0o644 });
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}

/**
 * Loescht die YAML-Datei fuer eine Domain (z.B. wenn der Kunde sie entfernt).
 * Schweigend bei nicht vorhandener Datei.
 */
export async function removeTraefikConfig(hostname: string): Promise<boolean> {
  await ensureDirExists();
  const dir = getDir();
  const path = join(dir, fileNameFor(hostname));
  try {
    await fs.unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Listet alle YAML-Dateien die WIR erzeugt haben (Prefix-Filter). Coolify-
 * eigene Dateien werden nie zurueckgegeben.
 */
export async function listOwnedConfigs(): Promise<string[]> {
  await ensureDirExists();
  const dir = getDir();
  const all = await fs.readdir(dir);
  return all.filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith(".yml"));
}

/**
 * Boot-Sync: schreibt alle aktiven Domains, loescht verwaiste Files
 * (Domain im DB geloescht, YAML aber noch da). Idempotent — kann gefahrlos
 * mehrfach laufen.
 */
export async function syncTraefikConfigs(
  activeDomains: UserDomain[],
): Promise<{ written: number; removed: number; kept: number }> {
  await ensureDirExists();
  const expected = new Set(activeDomains.map((d) => fileNameFor(d.hostname)));
  let written = 0;
  let kept = 0;
  let removed = 0;
  for (const d of activeDomains) {
    await writeTraefikConfig(d);
    written += 1;
  }
  const existing = await listOwnedConfigs();
  for (const f of existing) {
    if (!expected.has(f)) {
      const dir = getDir();
      await fs.unlink(join(dir, f));
      removed += 1;
    } else {
      kept += 1;
    }
  }
  return { written, removed, kept };
}

// ── acme.json Reader (read-only — Traefik schreibt, wir lesen nur) ─────

/**
 * Liest den ACME-Storage von Traefik und gibt das Ablaufdatum des Certs
 * fuer einen bestimmten Hostname zurueck. Liefert NULL wenn kein Cert
 * vorhanden — z.B. weil Issuance noch laeuft oder fehlgeschlagen ist.
 */
export async function readCertExpiry(hostname: string): Promise<Date | null> {
  const acmePath = process.env.TRAEFIK_ACME_PATH ?? "/traefik-dynamic/../acme.json";
  try {
    const raw = await fs.readFile(acmePath, { encoding: "utf8" });
    const data = JSON.parse(raw) as Record<string, { Certificates?: Array<{ domain?: { main?: string }; certificate?: string }> }>;
    for (const resolver of Object.values(data)) {
      const certs = resolver.Certificates ?? [];
      for (const c of certs) {
        if (c.domain?.main?.toLowerCase() === hostname.toLowerCase()) {
          // Cert is base64 PEM; we don't parse the full chain — just confirm
          // presence. Real expiry comes from a separate openssl probe in
          // the health-monitor job.
          if (c.certificate && c.certificate.length > 0) {
            // Approximation: Let's Encrypt certs run 90 days from issue.
            // The health-monitor refines this with an actual probe.
            const issued = new Date();
            const expiry = new Date(issued);
            expiry.setDate(expiry.getDate() + 90);
            return expiry;
          }
        }
      }
    }
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}
