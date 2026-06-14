-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0022: Public Password-Protected Campaign Shares
--
-- Erlaubt einem eingeloggten Owner, einen passwort-geschützten Public-Share-
-- Link für eine ganze Kampagne zu generieren (statt einzelne Lead-Pages
-- weiterzuleiten). Besucher öffnen `app.videocomet.de/share/<token>`, geben
-- das Passwort ein und sehen Engagement + Event-Stream für ALLE Leads dieser
-- Kampagne — read-only, ohne Tenant-Login.
--
-- Datenmodell:
--   campaign_shares          → ein Eintrag pro generiertem Link (Token +
--                              Argon2-Hash des Passworts + Owner-Scope).
--   campaign_share_attempts  → Audit-Log der Login-Versuche pro Token. Wird
--                              für Rate-Limiting (≥10 fails / 15 min → 429)
--                              genutzt; `ip_hash` ist sha256(ip).slice(0,16)
--                              damit kein raw-IP gespeichert wird.
--
-- Invarianten:
--   - `token` ist global eindeutig (UNIQUE-Index) und URL-safe (siehe
--     `src/lib/share-token.ts`).
--   - `password_hash` wird via Argon2id erzeugt (siehe `hashPassword` in
--     queries/users.ts).
--   - `revoked_at` ist eine manuelle Sperrung durch den Owner.
--     Public-Lookups filtern auf `revoked_at IS NULL`.
--   - `last_accessed_at` wird beim erfolgreichen Passwort-Login aktualisiert,
--     damit der Owner im UI sieht "letzter Zugriff vor 2 h".
--
-- Reversibel: zwei eigenständige Tabellen + Indexe, keine Änderung an
-- Bestandsschema. Roll-back-Snippet am Ende der Datei (commented out).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "campaign_shares" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id"       uuid NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE CASCADE,
  "user_id"           uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "token"             text NOT NULL,
  "password_hash"     text NOT NULL,
  "label"             text,
  "last_accessed_at"  timestamp with time zone,
  "revoked_at"        timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "campaign_share_attempts" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token"     text NOT NULL,
  "ip_hash"   text NOT NULL,
  "ok"        boolean NOT NULL,
  "ts"        timestamp with time zone NOT NULL DEFAULT now()
);

-- Token muss global eindeutig sein (Public-Lookup nur über Token).
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_shares_token_uq"
  ON "campaign_shares" ("token");

-- Owner-Listing: aktive Shares pro Kampagne. Partial-Index hält ihn klein
-- (revoked = "gelöscht aus Owner-Sicht").
CREATE INDEX IF NOT EXISTS "campaign_shares_campaign_idx"
  ON "campaign_shares" ("campaign_id") WHERE "revoked_at" IS NULL;

-- Tenant-Scope für "Alle Shares eines Users".
CREATE INDEX IF NOT EXISTS "campaign_shares_user_idx"
  ON "campaign_shares" ("user_id");

-- Rate-Limit-Lookup: letzte N Fehlversuche pro Token, sortiert DESC.
CREATE INDEX IF NOT EXISTS "campaign_share_attempts_token_ts_idx"
  ON "campaign_share_attempts" ("token", "ts" DESC);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Rollback (Ops, NICHT für Drizzle):
--
-- BEGIN;
-- DROP INDEX IF EXISTS "campaign_share_attempts_token_ts_idx";
-- DROP INDEX IF EXISTS "campaign_shares_user_idx";
-- DROP INDEX IF EXISTS "campaign_shares_campaign_idx";
-- DROP INDEX IF EXISTS "campaign_shares_token_uq";
-- DROP TABLE IF EXISTS "campaign_share_attempts";
-- DROP TABLE IF EXISTS "campaign_shares";
-- COMMIT;
-- ──────────────────────────────────────────────────────────────────────────
