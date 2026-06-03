/**
 * Queries für Webcam-Share-Links.
 *
 * Datenmodell: siehe `webcam_share_links` in schema.ts.
 *
 * Sicherheits-Invarianten:
 *  - `getShareLinkBySlugPublic()` liefert KEINE user_id zurück (nur Owner-
 *    Anzeigename), damit der Public-Endpoint nicht versehentlich tenant-
 *    Informationen leaked.
 *  - `markShareLinkUsed()` ist idempotent: setzt `used_at` + `media_item_id`
 *    nur, wenn der Slot noch frei ist (used_at IS NULL).
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, webcamShareLinks } from "@/lib/db/schema";

/** Formatiert die per-User numericId als sichtbare 3-stellige #ID. */
export function formatLinkId(numericId: number): string {
  return `#${String(numericId).padStart(3, "0")}`;
}

export type WebcamShareLink = typeof webcamShareLinks.$inferSelect;

/** Soft-Limit pro User (Spam-Guard). */
export const MAX_OPEN_SHARE_LINKS_PER_USER = 50;

/** Minimum/Maximum für maxDurationSec — sinnvolle Bounds. */
export const MIN_MAX_DURATION_SEC = 10;
export const MAX_MAX_DURATION_SEC = 900; // 15 Min

/** Slug-Alphabet: URL-safe, ohne ähnlich aussehende Zeichen (0/O, 1/l/I). */
const SLUG_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generiert einen kryptografisch zufälligen Slug. Standardlänge 14 → mehr
 * als ausreichende Entropie (57^14 ≈ 1.0e+24 Möglichkeiten) bei 12–16 Zeichen.
 */
export function generateShareSlug(length = 14): string {
  if (length < 12 || length > 16) {
    throw new Error("share slug length must be 12–16");
  }
  // Web Crypto ist auf Node 18+ als globalThis.crypto verfügbar; wir
  // nutzen es statt Math.random, da der Slug gegen Erraten geschützt sein muss.
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}

export interface CreateShareLinkInput {
  title: string | null;
  maxDurationSec: number;
  expiresAt: Date | null;
}

export interface CreateShareLinkOk {
  ok: true;
  link: WebcamShareLink;
}

export interface CreateShareLinkError {
  ok: false;
  code: "limit" | "internal";
  message: string;
}

/**
 * Legt einen neuen Share-Link an. Macht bis zu 5 Versuche bei (extrem
 * unwahrscheinlicher) Slug-Kollision.
 */
export async function createShareLink(
  userId: string,
  input: CreateShareLinkInput,
): Promise<CreateShareLinkOk | CreateShareLinkError> {
  // Spam-Guard: offene Links zählen
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webcamShareLinks)
    .where(
      and(
        eq(webcamShareLinks.userId, userId),
        isNull(webcamShareLinks.usedAt),
        isNull(webcamShareLinks.revokedAt),
      ),
    );
  if ((count ?? 0) >= MAX_OPEN_SHARE_LINKS_PER_USER) {
    return {
      ok: false,
      code: "limit",
      message: `Maximal ${MAX_OPEN_SHARE_LINKS_PER_USER} offene Links pro Konto.`,
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = generateShareSlug();
    try {
      // numeric_id wird atomic via SUBQUERY berechnet, damit zwei parallele
      // Inserts desselben Users nicht beide dieselbe ID setzen. Die UNIQUE
      // (user_id, numeric_id) wirft sonst — wir wiederholen dann den
      // Versuch (siehe catch unten).
      const [row] = await db
        .insert(webcamShareLinks)
        .values({
          userId,
          slug,
          title: input.title,
          maxDurationSec: input.maxDurationSec,
          expiresAt: input.expiresAt,
          numericId: sql<number>`(
            SELECT COALESCE(MAX(numeric_id), 0) + 1
            FROM ${webcamShareLinks}
            WHERE user_id = ${userId}
          )`,
        })
        .returning();
      if (row) return { ok: true, link: row };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Bei Slug- ODER numeric_id-Kollision (Race): nächsten Versuch.
      if (
        msg.includes("webcam_share_links_slug_uq") ||
        msg.includes("webcam_share_links_user_numeric_uq") ||
        msg.includes("duplicate key") ||
        msg.includes("unique")
      ) {
        continue;
      }
      throw err;
    }
  }
  return {
    ok: false,
    code: "internal",
    message: "Slug-Generierung fehlgeschlagen (Kollisionen).",
  };
}

/** Listet alle eigenen Links (neueste zuerst). */
export async function listShareLinksForUser(
  userId: string,
): Promise<WebcamShareLink[]> {
  return db
    .select()
    .from(webcamShareLinks)
    .where(eq(webcamShareLinks.userId, userId))
    .orderBy(desc(webcamShareLinks.createdAt));
}

/** Tenant-safer Lookup per Slug + UserId. */
export async function getOwnShareLinkBySlug(
  slug: string,
  userId: string,
): Promise<WebcamShareLink | null> {
  const [row] = await db
    .select()
    .from(webcamShareLinks)
    .where(
      and(eq(webcamShareLinks.slug, slug), eq(webcamShareLinks.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Owner-Sperre: setzt revoked_at auf NOW(), falls noch nicht gesetzt.
 * Returnt true, wenn die Aktion einen Eintrag verändert hat.
 */
export async function revokeShareLink(
  slug: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(webcamShareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(webcamShareLinks.slug, slug),
        eq(webcamShareLinks.userId, userId),
        isNull(webcamShareLinks.revokedAt),
      ),
    )
    .returning({ id: webcamShareLinks.id });
  return result.length > 0;
}

/**
 * Status für die Public-Page (`/r/[slug]`). Niemals die user_id offenlegen,
 * sondern nur den Anzeigename des Owners (Vor-/Nachname oder Firma).
 */
export type PublicShareStatus = "open" | "used" | "expired" | "revoked";

export interface PublicShareLinkInfo {
  slug: string;
  numericId: number;
  title: string | null;
  maxDurationSec: number;
  status: PublicShareStatus;
  ownerName: string;
}

export async function getShareLinkBySlugPublic(
  slug: string,
): Promise<PublicShareLinkInfo | null> {
  const [row] = await db
    .select({
      slug: webcamShareLinks.slug,
      numericId: webcamShareLinks.numericId,
      title: webcamShareLinks.title,
      maxDurationSec: webcamShareLinks.maxDurationSec,
      expiresAt: webcamShareLinks.expiresAt,
      usedAt: webcamShareLinks.usedAt,
      revokedAt: webcamShareLinks.revokedAt,
      firstName: users.firstName,
      lastName: users.lastName,
      companyName: users.companyName,
      email: users.email,
    })
    .from(webcamShareLinks)
    .innerJoin(users, eq(users.id, webcamShareLinks.userId))
    .where(eq(webcamShareLinks.slug, slug))
    .limit(1);
  if (!row) return null;

  let status: PublicShareStatus = "open";
  if (row.revokedAt) status = "revoked";
  else if (row.usedAt) status = "used";
  else if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    status = "expired";
  }

  // Anzeigename: Company > "Vorname Nachname" > Email (vor @).
  const fullName = [row.firstName, row.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const ownerName =
    (row.companyName?.trim() || fullName || row.email.split("@")[0]) ?? "";

  return {
    slug: row.slug,
    numericId: row.numericId,
    title: row.title,
    maxDurationSec: row.maxDurationSec,
    status,
    ownerName,
  };
}

/**
 * Liefert die ungeschützte Row inkl. user_id für die Submit-Verarbeitung.
 * Nur intern aus dem POST-Submit-Handler aufrufen.
 */
export async function getShareLinkBySlugInternal(
  slug: string,
): Promise<WebcamShareLink | null> {
  const [row] = await db
    .select()
    .from(webcamShareLinks)
    .where(eq(webcamShareLinks.slug, slug))
    .limit(1);
  return row ?? null;
}

/**
 * Atomic-Mark-Used: setzt used_at + media_item_id genau dann, wenn der Slot
 * noch frei ist. Returnt true im Erfolgsfall (=Owner soll Media behalten),
 * false wenn der Slot bereits belegt war (=Caller muss Media wieder löschen).
 */
export async function markShareLinkUsed(
  slug: string,
  mediaItemId: string,
): Promise<boolean> {
  const result = await db
    .update(webcamShareLinks)
    .set({ usedAt: new Date(), mediaItemId })
    .where(
      and(
        eq(webcamShareLinks.slug, slug),
        isNull(webcamShareLinks.usedAt),
        isNull(webcamShareLinks.revokedAt),
      ),
    )
    .returning({ id: webcamShareLinks.id });
  return result.length > 0;
}
