-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0059: Video-Feedback (Frame.io-artig für Master-Aufnahmen)
--
-- Erlaubt einem eingeloggten Owner, einen (optional passwortgeschützten)
-- Feedback-Link für das Master-Video einer Kampagne zu erzeugen. Empfänger
-- öffnen `app.videocomet.de/review/<token>`, sehen den Player und können
-- Kommentare mit Zeitstempel (einzeln oder als Bereich) hinterlassen —
-- ohne Login, nur mit einem Anzeigenamen.
--
-- Datenmodell:
--   video_feedback_links          → ein Eintrag pro Kampagne mit Token,
--                                    optionalem Argon2-Passwort, Ablauf,
--                                    Revoke, Owner-Scope. Unique Partial
--                                    Index sichert: pro Kampagne höchstens
--                                    EIN aktiver (nicht revoked) Link.
--   video_feedback_comments       → Kommentare an einem Link. `at_sec` NULL
--                                    → allgemeiner Kommentar; `at_end_sec`
--                                    NULL → Einzeltimestamp. Beides nicht
--                                    NULL → Bereichs-Kommentar. Ersteller-
--                                    Antwort in `owner_reply`, Erledigt via
--                                    `resolved_at`.
--   video_feedback_link_attempts  → Audit-Log der Passwort-Login-Versuche
--                                    pro Token (analog campaign_share_attempts).
--                                    `ip_hash` = sha256(ip).slice(0,16), kein
--                                    raw-IP (DSGVO).
--
-- Invarianten:
--   - `token` global eindeutig (UNIQUE-Index) und URL-safe (share-token.ts).
--   - `password_hash` optional (Argon2id) — NULL heisst "öffentlich".
--   - `revoked_at` = Owner-Kill; Public-Lookups filtern auf IS NULL.
--   - `expires_at` = harter Ablauf; Public-Lookups filtern > now().
--   - Löschen der Kampagne CASCADE-löscht Link + Kommentare (FK ON DELETE
--     CASCADE) — analog zum Verhalten von campaign_shares.
--
-- Reversibel: drei neue Tabellen + Indexe, keine Änderung an Bestandsschema.
-- Rollback-Snippet am Ende (auskommentiert).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "video_feedback_links" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id"       uuid NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE CASCADE,
  "user_id"           uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "token"             text NOT NULL,
  "password_hash"     text,
  "expires_at"        timestamp with time zone NOT NULL,
  "revoked_at"        timestamp with time zone,
  "last_accessed_at"  timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "video_feedback_comments" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id"      uuid NOT NULL REFERENCES "public"."video_feedback_links"("id") ON DELETE CASCADE,
  "at_sec"       double precision,
  "at_end_sec"   double precision,
  "author_name"  text NOT NULL,
  "body"         text NOT NULL,
  "owner_reply"  text,
  "resolved_at"  timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  -- Body-Grenzen erzwingen wir auch in der DB, damit ein direktes SQL-INSERT
  -- (z.B. Migration/Backfill) keine Riesen-Strings anlegt.
  CONSTRAINT "video_feedback_comments_body_len_chk"
    CHECK (char_length("body") BETWEEN 1 AND 2000),
  CONSTRAINT "video_feedback_comments_author_len_chk"
    CHECK (char_length("author_name") BETWEEN 1 AND 80),
  CONSTRAINT "video_feedback_comments_reply_len_chk"
    CHECK ("owner_reply" IS NULL OR char_length("owner_reply") BETWEEN 1 AND 2000),
  CONSTRAINT "video_feedback_comments_range_chk"
    CHECK (
      "at_sec" IS NULL
      OR "at_end_sec" IS NULL
      OR "at_end_sec" >= "at_sec"
    ),
  CONSTRAINT "video_feedback_comments_at_nonneg_chk"
    CHECK (("at_sec" IS NULL OR "at_sec" >= 0) AND ("at_end_sec" IS NULL OR "at_end_sec" >= 0))
);

CREATE TABLE IF NOT EXISTS "video_feedback_link_attempts" (
  "id"       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token"    text NOT NULL,
  "ip_hash"  text NOT NULL,
  "kind"     text NOT NULL,      -- 'auth' | 'comment'
  "ok"       boolean NOT NULL,
  "ts"       timestamp with time zone NOT NULL DEFAULT now()
);

-- Token global eindeutig (Public-Lookup nur über Token).
CREATE UNIQUE INDEX IF NOT EXISTS "video_feedback_links_token_uq"
  ON "video_feedback_links" ("token");

-- Pro Kampagne höchstens EIN aktiver (nicht revoked) Link — der Editor-Tab
-- zeigt genau einen Link an, "Neu erstellen" revoked erst den alten. Der
-- Partial-Index erzwingt das auf DB-Ebene, damit ein Race-Condition-Client
-- nicht zwei parallele Links anlegen kann.
CREATE UNIQUE INDEX IF NOT EXISTS "video_feedback_links_campaign_active_uq"
  ON "video_feedback_links" ("campaign_id") WHERE "revoked_at" IS NULL;

-- Owner-Listing: alle Links eines Users.
CREATE INDEX IF NOT EXISTS "video_feedback_links_user_idx"
  ON "video_feedback_links" ("user_id");

-- Kommentare pro Link chronologisch (Time-Sortierung, "N ungelesen"-Aggregat).
CREATE INDEX IF NOT EXISTS "video_feedback_comments_link_created_idx"
  ON "video_feedback_comments" ("link_id", "created_at" DESC);

-- Rate-Limit-Lookup: letzte N Versuche pro Token, sortiert DESC.
CREATE INDEX IF NOT EXISTS "video_feedback_link_attempts_token_ts_idx"
  ON "video_feedback_link_attempts" ("token", "ts" DESC);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Rollback (Ops, NICHT für Drizzle):
--
-- BEGIN;
-- DROP INDEX IF EXISTS "video_feedback_link_attempts_token_ts_idx";
-- DROP INDEX IF EXISTS "video_feedback_comments_link_created_idx";
-- DROP INDEX IF EXISTS "video_feedback_links_user_idx";
-- DROP INDEX IF EXISTS "video_feedback_links_campaign_active_uq";
-- DROP INDEX IF EXISTS "video_feedback_links_token_uq";
-- DROP TABLE IF EXISTS "video_feedback_link_attempts";
-- DROP TABLE IF EXISTS "video_feedback_comments";
-- DROP TABLE IF EXISTS "video_feedback_links";
-- COMMIT;
-- ──────────────────────────────────────────────────────────────────────────
