/**
 * CRUD-Queries für Custom-Domains.
 *
 * Wichtige Invarianten:
 *  - Hostnames sind case-insensitive eindeutig (Migration enforced via
 *    LOWER(hostname) UNIQUE-Index). Wir vergleichen IMMER lowercase.
 *  - Maximal 3 Domains pro User (Soft-Cap, hier durchgesetzt).
 *  - Löschen einer Domain mit aktiven Kampagnen ist erlaubt (Variante B),
 *    aber der Caller soll vorher die Anzahl der betroffenen Leads/Kampagnen
 *    holen und dem User zur Bestätigung zeigen.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  domainCheckLog,
  leads,
  userDomains,
  users,
} from "@/lib/db/schema";
import { generateVerifyToken, validateHostname, type DomainKind } from "@/lib/domain-utils";

export const MAX_DOMAINS_PER_USER = 3;

export type DomainStatus =
  | "pending"
  | "verifying"
  | "issuing_cert"
  | "active"
  | "failed";

export interface UserDomain {
  id: string;
  userId: string;
  hostname: string;
  kind: DomainKind;
  status: DomainStatus;
  verifyToken: string;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  rootRedirectUrl: string | null;
  createdAt: Date;
}

function rowToDomain(r: typeof userDomains.$inferSelect): UserDomain {
  return {
    id: r.id,
    userId: r.userId,
    hostname: r.hostname,
    kind: r.kind as DomainKind,
    status: r.status as DomainStatus,
    verifyToken: r.verifyToken,
    verifiedAt: r.verifiedAt,
    sslIssuedAt: r.sslIssuedAt,
    sslExpiresAt: r.sslExpiresAt,
    lastCheckedAt: r.lastCheckedAt,
    lastError: r.lastError,
    rootRedirectUrl: r.rootRedirectUrl,
    createdAt: r.createdAt,
  };
}

export interface CreateDomainError {
  ok: false;
  code: "invalid" | "duplicate" | "limit";
  message: string;
}

export interface CreateDomainOk {
  ok: true;
  domain: UserDomain;
}

/**
 * Legt eine neue Domain für einen User an. Validiert Hostname-Form, prüft
 * den globalen Hostname-Unique-Index und das Per-User-Limit.
 */
export async function createUserDomain(
  userId: string,
  hostnameInput: string,
): Promise<CreateDomainOk | CreateDomainError> {
  const v = validateHostname(hostnameInput);
  if (!v.ok) return { ok: false, code: "invalid", message: v.error };

  // Limit-Check
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userDomains)
    .where(eq(userDomains.userId, userId));
  if ((count ?? 0) >= MAX_DOMAINS_PER_USER) {
    return {
      ok: false,
      code: "limit",
      message: `Maximal ${MAX_DOMAINS_PER_USER} Domains pro Konto.`,
    };
  }

  // Insert; bei Race-Condition fangen wir den Unique-Violation-Error.
  try {
    const [row] = await db
      .insert(userDomains)
      .values({
        userId,
        hostname: v.hostname,
        kind: v.kind,
        status: "pending",
        verifyToken: generateVerifyToken(),
      })
      .returning();
    return { ok: true, domain: rowToDomain(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("user_domains_hostname_uq") || msg.includes("unique")) {
      return {
        ok: false,
        code: "duplicate",
        message: "Diese Domain ist bereits anderswo verbunden.",
      };
    }
    throw err;
  }
}

export async function listUserDomains(userId: string): Promise<UserDomain[]> {
  const rows = await db
    .select()
    .from(userDomains)
    .where(eq(userDomains.userId, userId))
    .orderBy(desc(userDomains.createdAt));
  return rows.map(rowToDomain);
}

export async function getUserDomain(
  domainId: string,
  userId: string,
): Promise<UserDomain | null> {
  const [row] = await db
    .select()
    .from(userDomains)
    .where(and(eq(userDomains.id, domainId), eq(userDomains.userId, userId)))
    .limit(1);
  return row ? rowToDomain(row) : null;
}

/** Admin-Lookup (kein Tenant-Filter). */
export async function getDomainByIdAdmin(
  domainId: string,
): Promise<UserDomain | null> {
  const [row] = await db
    .select()
    .from(userDomains)
    .where(eq(userDomains.id, domainId))
    .limit(1);
  return row ? rowToDomain(row) : null;
}

/** Lookup per Hostname (case-insensitive). Vom Middleware für Routing genutzt. */
export async function getDomainByHostname(
  hostname: string,
): Promise<UserDomain | null> {
  const h = hostname.toLowerCase().trim();
  const [row] = await db
    .select()
    .from(userDomains)
    .where(sql`LOWER(${userDomains.hostname}) = ${h}`)
    .limit(1);
  return row ? rowToDomain(row) : null;
}

/** Alle Domains in einem Status — für den Verifier-Worker. */
export async function listDomainsByStatus(
  statuses: DomainStatus[],
): Promise<UserDomain[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select()
    .from(userDomains)
    .where(sql`${userDomains.status} = ANY(ARRAY[${sql.join(statuses.map((s) => sql`${s}::text`), sql`, `)}])`);
  return rows.map(rowToDomain);
}

/** Alle aktiven Domains — für den Boot-Sync des Traefik-Writers. */
export async function listActiveDomains(): Promise<UserDomain[]> {
  const rows = await db
    .select()
    .from(userDomains)
    .where(eq(userDomains.status, "active"));
  return rows.map(rowToDomain);
}

export async function updateDomainStatus(
  domainId: string,
  patch: Partial<{
    status: DomainStatus;
    verifiedAt: Date | null;
    sslIssuedAt: Date | null;
    sslExpiresAt: Date | null;
    lastCheckedAt: Date | null;
    lastError: string | null;
  }>,
): Promise<void> {
  await db.update(userDomains).set(patch).where(eq(userDomains.id, domainId));
}

/** Setzt (oder loescht) das Root-Redirect-Ziel einer Domain. Tenant-scoped. */
export async function updateDomainRootRedirect(
  domainId: string,
  userId: string,
  rootRedirectUrl: string | null,
): Promise<boolean> {
  const rows = await db
    .update(userDomains)
    .set({ rootRedirectUrl })
    .where(and(eq(userDomains.id, domainId), eq(userDomains.userId, userId)))
    .returning({ id: userDomains.id });
  return rows.length > 0;
}

/**
 * Zaehlt die Auswirkungen einer Domain-Loeschung. Vom UI gezeigt, bevor
 * der User bestätigt (Variante B aus dem Konzept).
 */
export interface DomainImpact {
  affectedCampaigns: number;
  affectedLeads: number;
}

export async function getDomainImpact(domainId: string): Promise<DomainImpact> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(eq(campaigns.domainId, domainId));
  const [l] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.domainId, domainId));
  return {
    affectedCampaigns: c?.n ?? 0,
    affectedLeads: l?.n ?? 0,
  };
}

/**
 * Loescht eine Domain. Cascade auf `domain_check_log`; `campaigns.domain_id`
 * und `leads.domain_id` werden via FK `ON DELETE SET NULL` automatisch genullt.
 * → Alte URLs der betroffenen Leads gehen ins Leere (Variante B).
 */
export async function deleteUserDomain(
  domainId: string,
  userId: string,
): Promise<{ deleted: boolean; hostname: string | null }> {
  const [row] = await db
    .delete(userDomains)
    .where(and(eq(userDomains.id, domainId), eq(userDomains.userId, userId)))
    .returning({ hostname: userDomains.hostname });
  if (!row) return { deleted: false, hostname: null };
  return { deleted: true, hostname: row.hostname };
}

// ── Admin ─────────────────────────────────────────────────────────────────

/**
 * Loescht eine Domain ohne Tenant-Filter (Admin-Override). Returnt den
 * gelöschten Hostname, damit der Caller die Traefik-YAML cleanen kann.
 */
export async function deleteUserDomainAdmin(
  domainId: string,
): Promise<{ deleted: boolean; hostname: string | null }> {
  const [row] = await db
    .delete(userDomains)
    .where(eq(userDomains.id, domainId))
    .returning({ hostname: userDomains.hostname });
  if (!row) return { deleted: false, hostname: null };
  return { deleted: true, hostname: row.hostname };
}

/**
 * Setzt eine Domain zurück auf den Initial-State: status='pending',
 * lastError=null, alle Cert-/Verify-Timestamps gelöscht. Der Verifier-Worker
 * picked sie beim nächsten Tick wieder auf.
 */
export async function resetDomainAdmin(domainId: string): Promise<void> {
  await db
    .update(userDomains)
    .set({
      status: "pending",
      lastError: null,
      lastCheckedAt: null,
      verifiedAt: null,
      sslIssuedAt: null,
      sslExpiresAt: null,
    })
    .where(eq(userDomains.id, domainId));
}

export interface AdminDomainRow extends UserDomain {
  userEmail: string;
  userName: string | null;
}

export async function listAllDomainsForAdmin(): Promise<AdminDomainRow[]> {
  const rows = await db
    .select({
      domain: userDomains,
      userEmail: users.email,
      userFirst: users.firstName,
      userLast: users.lastName,
      userCompany: users.companyName,
    })
    .from(userDomains)
    .innerJoin(users, eq(users.id, userDomains.userId))
    .orderBy(desc(userDomains.createdAt));
  return rows.map((r) => ({
    ...rowToDomain(r.domain),
    userEmail: r.userEmail,
    userName:
      r.userCompany ||
      [r.userFirst, r.userLast].filter(Boolean).join(" ").trim() ||
      null,
  }));
}

// ── Check-Log ─────────────────────────────────────────────────────────────

export async function logDomainCheck(
  domainId: string,
  kind: "dns" | "txt" | "cert" | "health",
  ok: boolean,
  message?: string | null,
): Promise<void> {
  await db.insert(domainCheckLog).values({
    domainId,
    kind,
    ok,
    message: message ?? null,
  });
}

export interface DomainLogRow {
  id: string;
  ts: Date;
  kind: string;
  ok: boolean;
  message: string | null;
}

export async function listDomainCheckLog(
  domainId: string,
  limit = 20,
): Promise<DomainLogRow[]> {
  const rows = await db
    .select({
      id: domainCheckLog.id,
      ts: domainCheckLog.ts,
      kind: domainCheckLog.kind,
      ok: domainCheckLog.ok,
      message: domainCheckLog.message,
    })
    .from(domainCheckLog)
    .where(eq(domainCheckLog.domainId, domainId))
    .orderBy(desc(domainCheckLog.ts))
    .limit(limit);
  return rows;
}
