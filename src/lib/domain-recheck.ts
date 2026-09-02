/**
 * Domain-Recheck aus dem APP-Prozess heraus — OHNE Dateisystem-Zugriff.
 *
 * Hintergrund (Security-Härtung 2026-09-02): Bis dahin importierten die
 * API-Routen `/api/domains/:id/verify` und `/api/admin/domains/:id/recheck`
 * den Worker-Job `forceDomainRecheck`, der direkt Traefik-YAMLs schreibt
 * und `acme.json` liest. Dafür musste der App-Container als Root mit
 * rw-Mount auf `/data/coolify/proxy/dynamic` und Lesezugriff auf ALLE
 * TLS-Private-Keys laufen. Eine einzige RCE in irgendeiner App-Route hätte
 * genügt, um den gesamten Host-Verkehr umzuleiten.
 *
 * Neue Arbeitsteilung:
 *   - App: DNS + TXT prüfen (reine Netz-Lookups), Check-Log schreiben,
 *     Status in der DB fortschreiben (pending → verifying, 24h-Fail).
 *   - Worker (30-s-Tick, `worker/jobs/domain-verifier.ts`): schreibt bei
 *     `verifying` mit erfolgreichem Check die Traefik-YAML, prüft das Cert
 *     und setzt `issuing_cert`/`active`. Räumt verwaiste YAMLs auf
 *     (gelöschte oder zurückgesetzte Domains).
 *
 * Für den Nutzer ändert sich nur, dass zwischen "DNS ok" und "SSL aktiv"
 * bis zu 30 s liegen — vorher war es dieselbe Wartezeit auf Let's Encrypt.
 */

import {
  getDomainByIdAdmin,
  logDomainCheck,
  updateDomainStatus,
  type UserDomain,
} from "@/lib/db/queries/user-domains";
import { verifyDomain } from "@/lib/dns-verifier";

const FAIL_AFTER_HOURS = 24;

/**
 * Prüft DNS + TXT einer Domain sofort und schreibt das Ergebnis in die DB.
 * Schreibt KEINE Traefik-Dateien. Returnt die aktualisierte Domain oder
 * null, wenn sie nicht existiert.
 */
export async function requestDomainRecheck(domainId: string): Promise<UserDomain | null> {
  const d = await getDomainByIdAdmin(domainId);
  if (!d) return null;

  const v = await verifyDomain(d.hostname, d.verifyToken);
  await logDomainCheck(d.id, "dns", v.dnsOk, v.dnsMessage);
  await logDomainCheck(d.id, "txt", v.txtOk, v.txtMessage);

  const now = new Date();
  const ageHours = (now.getTime() - d.createdAt.getTime()) / 3_600_000;

  if (!v.ready) {
    if (ageHours >= FAIL_AFTER_HOURS && d.status !== "failed") {
      await updateDomainStatus(d.id, {
        status: "failed",
        lastCheckedAt: now,
        lastError: `Nach ${FAIL_AFTER_HOURS}h immer noch nicht verifiziert. DNS: ${v.dnsMessage ?? "?"}. TXT: ${v.txtMessage ?? "?"}.`,
      });
    } else {
      await updateDomainStatus(d.id, {
        status: d.status === "pending" ? "verifying" : d.status,
        lastCheckedAt: now,
        lastError: [v.dnsMessage, v.txtMessage].filter(Boolean).join(" | "),
      });
    }
    return getDomainByIdAdmin(domainId);
  }

  if (d.status === "active") {
    await updateDomainStatus(d.id, { lastCheckedAt: now, lastError: null });
    return getDomainByIdAdmin(domainId);
  }

  // DNS + TXT ok, aber noch kein Routing: auf `verifying` stellen (bzw.
  // dort belassen). Der Worker-Tick schreibt binnen 30 s die Traefik-YAML
  // und führt die Domain nach `issuing_cert` → `active`.
  await updateDomainStatus(d.id, {
    status: d.status === "issuing_cert" ? "issuing_cert" : "verifying",
    verifiedAt: d.verifiedAt ?? now,
    lastCheckedAt: now,
    lastError: null,
  });
  await logDomainCheck(
    d.id,
    "cert",
    true,
    "DNS bestätigt. Routing und SSL-Zertifikat werden jetzt vom Hintergrunddienst eingerichtet (bis zu 30 Sekunden).",
  );
  return getDomainByIdAdmin(domainId);
}
