/**
 * Queries für Video-Feedback (Migration 0059).
 *
 * Datenmodell: `videoFeedbackLinks` + `videoFeedbackComments` +
 * `videoFeedbackLinkAttempts` (schema.ts).
 *
 * Sicherheits-Invarianten:
 *  - `getActiveLinkByToken` liefert KEINE Owner-Metadaten außer `userId`
 *    (Tenant-Guard) und `campaignId` — kein Passwort-Hash im Return.
 *  - Alle Owner-Endpunkte prüfen Campaign-Ownership über den Join auf
 *    `campaigns.userId = userId` (inklusive `deletedAt IS NULL`, sonst
 *    kann man an einer gerade gelöschten Kampagne noch Kommentare bauen).
 *  - `insertComment` schneidet Body/Author auf DB-Constraints — die
 *    CHECK-Constraints sind Fail-Safe, die JS-Trims sind der Standardpfad.
 *  - `recordAttempt` speichert `ip_hash = sha256(ip).slice(0,16)`.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  mediaItems,
  videoFeedbackComments,
  videoFeedbackLinkAttempts,
  videoFeedbackLinks,
} from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/db/queries/users";
import { generateShareToken } from "@/lib/share-token";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActiveFeedbackLink {
  id: string;
  campaignId: string;
  userId: string;
  token: string;
  hasPassword: boolean;
  expiresAt: Date;
  lastAccessedAt: Date | null;
  createdAt: Date;
}

export interface FeedbackVideoMeta {
  campaignId: string;
  campaignName: string;
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export interface FeedbackCommentRow {
  id: string;
  atSec: number | null;
  atEndSec: number | null;
  authorName: string;
  body: string;
  ownerReply: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerLinkView extends ActiveFeedbackLink {
  video: FeedbackVideoMeta;
  comments: FeedbackCommentRow[];
  unresolvedCount: number;
}

// ── Body-Limits (Fallback zu DB-CHECK-Constraints) ──────────────────────────

/** Maximale Body-Länge eines Empfänger-Kommentars. */
export const COMMENT_BODY_MAX = 2000;
/** Maximale Länge des Anzeigenamens. */
export const COMMENT_AUTHOR_MAX = 80;
/** Owner-Antwort-Limit (analog Body). */
export const COMMENT_REPLY_MAX = 2000;

/** Fensterlänge für Rate-Limit-Check (15 min). */
export const ATTEMPT_WINDOW_SEC = 15 * 60;

// ── Public-Lookup ────────────────────────────────────────────────────────────

/**
 * Sucht einen aktiven Link (nicht revoked, nicht abgelaufen) per Token.
 * Returnt `null` bei jedem Fehlschlag — der Aufrufer darf zwischen "nicht
 * existiert" und "revoked/abgelaufen" nicht unterscheiden können (Token-
 * Enumeration).
 */
export async function getActiveLinkByToken(
  token: string,
): Promise<
  | (ActiveFeedbackLink & { passwordHash: string | null })
  | null
> {
  const [row] = await db
    .select({
      id: videoFeedbackLinks.id,
      campaignId: videoFeedbackLinks.campaignId,
      userId: videoFeedbackLinks.userId,
      token: videoFeedbackLinks.token,
      passwordHash: videoFeedbackLinks.passwordHash,
      expiresAt: videoFeedbackLinks.expiresAt,
      lastAccessedAt: videoFeedbackLinks.lastAccessedAt,
      createdAt: videoFeedbackLinks.createdAt,
    })
    .from(videoFeedbackLinks)
    .where(
      and(
        eq(videoFeedbackLinks.token, token),
        isNull(videoFeedbackLinks.revokedAt),
        sql`${videoFeedbackLinks.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaignId,
    userId: row.userId,
    token: row.token,
    hasPassword: !!row.passwordHash,
    passwordHash: row.passwordHash,
    expiresAt: row.expiresAt,
    lastAccessedAt: row.lastAccessedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Video-Metadaten für die Player-Ansicht. Der Public-Reviewer bekommt nur
 * das, was für Wiedergabe nötig ist — kein Owner-Feld, keine Segmente.
 * Fällt sauber zurück wenn die Kampagne kein Master-Video hat.
 */
export async function getFeedbackVideoMeta(
  campaignId: string,
): Promise<FeedbackVideoMeta | null> {
  const [row] = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      deletedAt: campaigns.deletedAt,
      webcamMediaId: campaigns.webcamMediaId,
      videoUrl: mediaItems.publicUrl,
      durationSec: mediaItems.durationSec,
      width: mediaItems.width,
      height: mediaItems.height,
    })
    .from(campaigns)
    .leftJoin(mediaItems, eq(mediaItems.id, campaigns.webcamMediaId))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return {
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    videoUrl: row.videoUrl ?? null,
    posterUrl: null,
    durationSec: row.durationSec ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
  };
}

// ── Rate-Limit (Passwort + Kommentar-Insert) ────────────────────────────────

/** Zählt Fehlversuche (`ok=false`) einer bestimmten Art im Zeitfenster. */
export async function countRecentFailedAttempts(
  token: string,
  ipHash: string,
  kind: "auth" | "comment",
  windowSec = ATTEMPT_WINDOW_SEC,
): Promise<number> {
  const sinceIso = new Date(Date.now() - windowSec * 1000).toISOString();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(videoFeedbackLinkAttempts)
    .where(
      and(
        eq(videoFeedbackLinkAttempts.token, token),
        eq(videoFeedbackLinkAttempts.ipHash, ipHash),
        eq(videoFeedbackLinkAttempts.kind, kind),
        eq(videoFeedbackLinkAttempts.ok, false),
        sql`${videoFeedbackLinkAttempts.ts} >= ${sinceIso}`,
      ),
    );
  return row?.count ?? 0;
}

/** Zählt ALLE Attempts (ok und fail) — für Kommentar-Insert-Ratenlimit. */
export async function countRecentAttempts(
  token: string,
  ipHash: string,
  kind: "auth" | "comment",
  windowSec = ATTEMPT_WINDOW_SEC,
): Promise<number> {
  const sinceIso = new Date(Date.now() - windowSec * 1000).toISOString();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(videoFeedbackLinkAttempts)
    .where(
      and(
        eq(videoFeedbackLinkAttempts.token, token),
        eq(videoFeedbackLinkAttempts.ipHash, ipHash),
        eq(videoFeedbackLinkAttempts.kind, kind),
        sql`${videoFeedbackLinkAttempts.ts} >= ${sinceIso}`,
      ),
    );
  return row?.count ?? 0;
}

/** Audit-Log für Passwort-Login und Kommentar-Inserts. */
export async function recordAttempt(
  token: string,
  ipHash: string,
  kind: "auth" | "comment",
  ok: boolean,
): Promise<void> {
  await db.insert(videoFeedbackLinkAttempts).values({ token, ipHash, kind, ok });
}

/** Setzt last_accessed_at auf jetzt. */
export async function updateLinkLastAccessed(linkId: string): Promise<void> {
  await db
    .update(videoFeedbackLinks)
    .set({ lastAccessedAt: new Date() })
    .where(eq(videoFeedbackLinks.id, linkId));
}

// ── Passwort-Check ──────────────────────────────────────────────────────────

/**
 * Prüft ein Passwort gegen den gespeicherten Argon2-Hash. Für Links ohne
 * Passwort (`passwordHash IS NULL`) MUSS der Aufrufer diesen Pfad
 * überspringen — wir returnen defensive false.
 */
export async function verifyLinkPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  if (!passwordHash) return false;
  if (typeof password !== "string" || password.length === 0) return false;
  try {
    return await verifyPassword(passwordHash, password);
  } catch {
    return false;
  }
}

// ── Owner-API: Link erstellen/aktualisieren/löschen ──────────────────────────

export interface CreateLinkInput {
  campaignId: string;
  userId: string;
  ttlDays: number;
  password?: string | null;
}

export interface CreateLinkResult {
  id: string;
  token: string;
}

const CREATE_LINK_MAX_TOKEN_ATTEMPTS = 5;

/**
 * Erzeugt einen neuen Link ODER rotiert einen bestehenden aktiven Link
 * (revoked den alten und legt einen neuen an — mit neuem Token, damit
 * bereits verteilte Links sofort tot sind). Kein Duplikat pro Kampagne
 * (Partial-Unique-Index in DB als Fail-Safe).
 *
 * Prüft Campaign-Ownership inline; wirft `Error("Not found")` bei Mismatch
 * oder wenn die Kampagne soft-deleted ist.
 */
export async function createLinkForCampaign(
  opts: CreateLinkInput,
): Promise<CreateLinkResult> {
  const [camp] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, opts.campaignId),
        eq(campaigns.userId, opts.userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);
  if (!camp) throw new Error("Not found");

  if (!Number.isFinite(opts.ttlDays) || opts.ttlDays < 1 || opts.ttlDays > 90) {
    throw new Error("Ungültige Gültigkeitsdauer (1–90 Tage).");
  }

  const passwordHash = opts.password
    ? await hashPassword(opts.password)
    : null;

  const expiresAt = new Date(Date.now() + opts.ttlDays * 24 * 60 * 60 * 1000);

  // Bestehenden aktiven Link revoken (Partial-Unique-Index würde sonst greifen).
  await db
    .update(videoFeedbackLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(videoFeedbackLinks.campaignId, opts.campaignId),
        eq(videoFeedbackLinks.userId, opts.userId),
        isNull(videoFeedbackLinks.revokedAt),
      ),
    );

  let lastError: unknown = null;
  for (let attempt = 0; attempt < CREATE_LINK_MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = generateShareToken(24);
    try {
      const [row] = await db
        .insert(videoFeedbackLinks)
        .values({
          campaignId: opts.campaignId,
          userId: opts.userId,
          token,
          passwordHash,
          expiresAt,
        })
        .returning({ id: videoFeedbackLinks.id, token: videoFeedbackLinks.token });
      if (!row) throw new Error("Insert failed");
      return { id: row.id, token: row.token };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Konnte keinen eindeutigen Token erzeugen: ${(lastError as Error).message}`,
  );
}

/**
 * Aktualisiert Passwort und/oder Ablauf eines aktiven Links. Passwort:
 * `null` → entfernt, `""` → unverändert, sonst → neu-hash. Ablauf: ISO/`Date`
 * oder `undefined`. Tenant-guarded via `userId`.
 */
export async function updateLink(
  linkId: string,
  userId: string,
  patch: {
    password?: string | null;
    ttlDays?: number;
  },
): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.password === null) {
    set.passwordHash = null;
  } else if (typeof patch.password === "string" && patch.password.length > 0) {
    set.passwordHash = await hashPassword(patch.password);
  }

  if (patch.ttlDays !== undefined) {
    if (!Number.isFinite(patch.ttlDays) || patch.ttlDays < 1 || patch.ttlDays > 90) {
      throw new Error("Ungültige Gültigkeitsdauer (1–90 Tage).");
    }
    set.expiresAt = new Date(Date.now() + patch.ttlDays * 24 * 60 * 60 * 1000);
  }

  const result = await db
    .update(videoFeedbackLinks)
    .set(set)
    .where(
      and(
        eq(videoFeedbackLinks.id, linkId),
        eq(videoFeedbackLinks.userId, userId),
        isNull(videoFeedbackLinks.revokedAt),
      ),
    )
    .returning({ id: videoFeedbackLinks.id });
  return result.length > 0;
}

/** Sperrt den aktuellen aktiven Link einer Kampagne (idempotent). */
export async function revokeLinkForCampaign(
  campaignId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(videoFeedbackLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(videoFeedbackLinks.campaignId, campaignId),
        eq(videoFeedbackLinks.userId, userId),
        isNull(videoFeedbackLinks.revokedAt),
      ),
    )
    .returning({ id: videoFeedbackLinks.id });
  return result.length > 0;
}

/**
 * Owner-Sicht: den aktuellen aktiven Link inkl. Video-Meta und Kommentaren.
 * Kein Passwort-Hash im Return. Returnt `null` wenn kein aktiver Link
 * existiert.
 */
export async function getOwnerLinkForCampaign(
  campaignId: string,
  userId: string,
): Promise<OwnerLinkView | null> {
  const [link] = await db
    .select({
      id: videoFeedbackLinks.id,
      campaignId: videoFeedbackLinks.campaignId,
      userId: videoFeedbackLinks.userId,
      token: videoFeedbackLinks.token,
      hasPassword: sql<boolean>`${videoFeedbackLinks.passwordHash} IS NOT NULL`,
      expiresAt: videoFeedbackLinks.expiresAt,
      lastAccessedAt: videoFeedbackLinks.lastAccessedAt,
      createdAt: videoFeedbackLinks.createdAt,
    })
    .from(videoFeedbackLinks)
    .innerJoin(campaigns, eq(campaigns.id, videoFeedbackLinks.campaignId))
    .where(
      and(
        eq(videoFeedbackLinks.campaignId, campaignId),
        eq(videoFeedbackLinks.userId, userId),
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt),
        isNull(videoFeedbackLinks.revokedAt),
      ),
    )
    .limit(1);
  if (!link) return null;

  const video = await getFeedbackVideoMeta(campaignId);
  const comments = await listComments(link.id);
  const unresolved = comments.filter((c) => c.resolvedAt == null).length;

  return {
    id: link.id,
    campaignId: link.campaignId,
    userId: link.userId,
    token: link.token,
    hasPassword: !!link.hasPassword,
    expiresAt: link.expiresAt,
    lastAccessedAt: link.lastAccessedAt,
    createdAt: link.createdAt,
    video: video ?? {
      campaignId,
      campaignName: "",
      videoUrl: null,
      posterUrl: null,
      durationSec: null,
      width: null,
      height: null,
    },
    comments,
    unresolvedCount: unresolved,
  };
}

// ── Kommentare ──────────────────────────────────────────────────────────────

export async function listComments(linkId: string): Promise<FeedbackCommentRow[]> {
  const rows = await db
    .select({
      id: videoFeedbackComments.id,
      atSec: videoFeedbackComments.atSec,
      atEndSec: videoFeedbackComments.atEndSec,
      authorName: videoFeedbackComments.authorName,
      body: videoFeedbackComments.body,
      ownerReply: videoFeedbackComments.ownerReply,
      resolvedAt: videoFeedbackComments.resolvedAt,
      createdAt: videoFeedbackComments.createdAt,
      updatedAt: videoFeedbackComments.updatedAt,
    })
    .from(videoFeedbackComments)
    .where(eq(videoFeedbackComments.linkId, linkId))
    .orderBy(desc(videoFeedbackComments.createdAt));
  return rows.map((r) => ({
    id: r.id,
    atSec: r.atSec,
    atEndSec: r.atEndSec,
    authorName: r.authorName,
    body: r.body,
    ownerReply: r.ownerReply,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export interface InsertCommentInput {
  linkId: string;
  atSec: number | null;
  atEndSec: number | null;
  authorName: string;
  body: string;
}

/**
 * Fügt einen Kommentar ein. Trimmt/Kürzt Body und Author defensiv auf die
 * DB-Constraints. Validiert Zeitwerte:
 *   - beide numerisch (oder null) und ≥ 0
 *   - at_end_sec ≥ at_sec wenn beide gesetzt
 */
export async function insertComment(
  input: InsertCommentInput,
): Promise<FeedbackCommentRow> {
  const authorName = input.authorName.trim().slice(0, COMMENT_AUTHOR_MAX);
  const body = input.body.trim().slice(0, COMMENT_BODY_MAX);
  if (!authorName || !body) throw new Error("Name und Kommentar sind Pflicht.");

  const at = normalizeTime(input.atSec);
  const end = normalizeTime(input.atEndSec);
  if (at !== null && end !== null && end < at) {
    throw new Error("Endzeit darf nicht vor der Startzeit liegen.");
  }
  // Wenn nur Endzeit gesetzt: Bereich braucht auch Start.
  const finalStart = at;
  const finalEnd = at !== null ? end : null;

  const [row] = await db
    .insert(videoFeedbackComments)
    .values({
      linkId: input.linkId,
      atSec: finalStart,
      atEndSec: finalEnd,
      authorName,
      body,
    })
    .returning({
      id: videoFeedbackComments.id,
      atSec: videoFeedbackComments.atSec,
      atEndSec: videoFeedbackComments.atEndSec,
      authorName: videoFeedbackComments.authorName,
      body: videoFeedbackComments.body,
      ownerReply: videoFeedbackComments.ownerReply,
      resolvedAt: videoFeedbackComments.resolvedAt,
      createdAt: videoFeedbackComments.createdAt,
      updatedAt: videoFeedbackComments.updatedAt,
    });
  if (!row) throw new Error("Insert failed");
  return row;
}

/**
 * Ersteller markiert einen Kommentar als (nicht) erledigt. Tenant-Guard
 * über den Join auf `link.userId = userId`. `commentId` allein leakt keine
 * fremden Kommentare, weil das UPDATE-Filter nicht matched.
 */
export async function setResolved(
  commentId: string,
  userId: string,
  resolved: boolean,
): Promise<boolean> {
  // Sub-select um Ownership zu prüfen (kein direktes update-join in drizzle).
  const linkIdSub = sql`(
    SELECT ${videoFeedbackLinks.id} FROM ${videoFeedbackLinks}
    WHERE ${videoFeedbackLinks.id} = ${videoFeedbackComments.linkId}
      AND ${videoFeedbackLinks.userId} = ${userId}
    LIMIT 1
  )`;
  const result = await db
    .update(videoFeedbackComments)
    .set({
      resolvedAt: resolved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(videoFeedbackComments.id, commentId),
        sql`${linkIdSub} IS NOT NULL`,
      ),
    )
    .returning({ id: videoFeedbackComments.id });
  return result.length > 0;
}

/** Ersteller-Antwort auf einen Kommentar setzen/entfernen (`""` → entfernen). */
export async function setOwnerReply(
  commentId: string,
  userId: string,
  reply: string | null,
): Promise<boolean> {
  const clean = reply == null ? null : reply.trim().slice(0, COMMENT_REPLY_MAX);
  const value = !clean ? null : clean;
  const linkIdSub = sql`(
    SELECT ${videoFeedbackLinks.id} FROM ${videoFeedbackLinks}
    WHERE ${videoFeedbackLinks.id} = ${videoFeedbackComments.linkId}
      AND ${videoFeedbackLinks.userId} = ${userId}
    LIMIT 1
  )`;
  const result = await db
    .update(videoFeedbackComments)
    .set({ ownerReply: value, updatedAt: new Date() })
    .where(
      and(
        eq(videoFeedbackComments.id, commentId),
        sql`${linkIdSub} IS NOT NULL`,
      ),
    )
    .returning({ id: videoFeedbackComments.id });
  return result.length > 0;
}

/** Ersteller löscht einen Kommentar (Hard-Delete). */
export async function deleteComment(
  commentId: string,
  userId: string,
): Promise<boolean> {
  const linkIdSub = sql`(
    SELECT ${videoFeedbackLinks.id} FROM ${videoFeedbackLinks}
    WHERE ${videoFeedbackLinks.id} = ${videoFeedbackComments.linkId}
      AND ${videoFeedbackLinks.userId} = ${userId}
    LIMIT 1
  )`;
  const result = await db
    .delete(videoFeedbackComments)
    .where(
      and(
        eq(videoFeedbackComments.id, commentId),
        sql`${linkIdSub} IS NOT NULL`,
      ),
    )
    .returning({ id: videoFeedbackComments.id });
  return result.length > 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTime(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0) return 0;
  // Praktisches Deckel bei 7200 s (2 h) — realistisch selbst für lange Videos,
  // schützt vor absurd großen Floats aus manipulierten Requests.
  if (v > 7200) return 7200;
  return Math.round(v * 100) / 100;
}
