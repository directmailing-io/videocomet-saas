-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0013: bunny_assets + bunny_asset_refs
--
-- Zentraler Asset-Index für ALLE Bunny-Objekte (Stream-Videos & Storage-
-- Files). Bisher tragen Tabellen wie `leads`, `runs`, `media_items` und
-- `webcam_share_links` direkt die Bunny-IDs/URLs — was bedeutet: kein
-- gemeinsamer Index, kein Dedupe und kein zentraler Purge-Worker.
--
-- Diese Migration führt das `bunny_assets`-Register ein. Jeder hochgeladene
-- Bunny-Asset bekommt eine Zeile; Owner-Tabellen referenzieren via
-- `bunny_asset_refs` (m:n) statt die Bunny-ID direkt zu speichern. Sobald
-- der letzte Ref fällt, kann der Purge-Worker (Paket E) die Datei
-- physisch löschen.
--
-- Idempotenz: alle Statements via `IF NOT EXISTS` (Tabellen, Spalten,
-- Indices). Komplettes File läuft in EINER Transaction → halbe Migration
-- kann nicht persistieren.
--
-- Reversibel: DROP TABLE bunny_asset_refs; DROP TABLE bunny_assets;
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── bunny_assets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bunny_assets" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"          uuid NOT NULL,
  "kind"             text NOT NULL,
  "bunny_id"         text NOT NULL,
  "cdn_url"          text NOT NULL,
  "width"            integer,
  "height"           integer,
  "bytes"            integer,
  "source_hash"      text,
  "purge_state"      text NOT NULL DEFAULT 'live',
  "purge_attempts"   integer NOT NULL DEFAULT 0,
  "purge_last_error" text,
  "purged_at"        timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bunny_assets_kind_check"
    CHECK ("kind" IN ('stream','storage')),
  CONSTRAINT "bunny_assets_purge_state_check"
    CHECK ("purge_state" IN ('live','purge_pending','purged'))
);

-- FK auf users — separat per ALTER (mit IF NOT EXISTS-Workaround via
-- DO-Block), damit re-runs nicht crashen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bunny_assets_user_id_fk'
  ) THEN
    ALTER TABLE "bunny_assets"
      ADD CONSTRAINT "bunny_assets_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
  END IF;
END$$;

-- Unique-Scope: ein Bunny-Asset (kind + bunny_id) gehört genau einem User.
CREATE UNIQUE INDEX IF NOT EXISTS "bunny_assets_user_kind_id_uq"
  ON "bunny_assets" ("user_id", "kind", "bunny_id");

-- Worker-Index für Purge-Pickup: ältester `purge_pending` zuerst.
CREATE INDEX IF NOT EXISTS "bunny_assets_purge_state_idx"
  ON "bunny_assets" ("purge_state", "created_at");

-- ── bunny_asset_refs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bunny_asset_refs" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id"   uuid NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id"   uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bunny_asset_refs_owner_type_check"
    CHECK ("owner_type" IN ('lead','run','media_item','campaign_webcam'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bunny_asset_refs_asset_id_fk'
  ) THEN
    ALTER TABLE "bunny_asset_refs"
      ADD CONSTRAINT "bunny_asset_refs_asset_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."bunny_assets"("id") ON DELETE CASCADE;
  END IF;
END$$;

-- Kein Doppel-Ref derselben Owner-Zeile auf denselben Asset.
CREATE UNIQUE INDEX IF NOT EXISTS "bunny_asset_refs_owner_uq"
  ON "bunny_asset_refs" ("asset_id", "owner_type", "owner_id");

-- Lookup by Owner: „welche Assets hängen an diesem Lead/Run?".
CREATE INDEX IF NOT EXISTS "bunny_asset_refs_owner_idx"
  ON "bunny_asset_refs" ("owner_type", "owner_id");

COMMIT;
