-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0026: URL-Mediathek
--
-- Zweck:
--   Speichert User-URLs (primaer Google Docs/Sheets/Slides, aber auch
--   YouTube + beliebige Links) mit auto-generiertem Preview-Bild. Wird im
--   Campaign-Wizard als Combobox-Quelle fuer Brief-Template-URLs angeboten
--   damit der User nicht jedes Mal die gleiche Google-Docs-URL eintippen
--   muss.
--
-- Datenmodell:
--   media_urls   Eine Row pro gespeicherter URL. Soft-Delete nicht
--                vorgesehen — Mediathek-Dateien haben auch keinen, das
--                halten wir konsistent.
--
-- Sicherheit:
--   - URL muss von der Application-Layer durch `src/lib/media-urls/
--     ssrf-guard.ts` validiert werden (private CIDRs blockieren) BEVOR
--     gespeichert wird. Keine CHECK-Constraint, weil DNS-Resolution nicht
--     in SQL machbar.
--   - `url_hash` ist sha256 der normalisierten URL (lowercased host, ohne
--     `?usp=sharing` etc.) → erlaubt Duplicate-Detection ohne Volltext-
--     Vergleich.
--
-- Preview-Lifecycle:
--   pending → BullMQ-Job laeuft → ready ODER error ODER private
--   `previewExpiresAt` markiert UI-Stale-Hinweis (7d Docs / 30d sonst).
-- ──────────────────────────────────────────────────────────────────────────

-- Enums
DO $$ BEGIN
  CREATE TYPE "media_url_type" AS ENUM (
    'gdoc', 'gsheet', 'gslides', 'gform', 'gdrive_file', 'youtube', 'generic'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "media_url_preview_status" AS ENUM (
    'pending', 'ready', 'error', 'private'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabelle
CREATE TABLE IF NOT EXISTS "media_urls" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "url"                      text NOT NULL,
  "url_hash"                 text NOT NULL,
  "type"                     "media_url_type" NOT NULL DEFAULT 'generic',
  "title"                    text NOT NULL,
  "description"              text,
  "external_resource_id"     text,
  "preview_bunny_path"       text,
  "preview_url"              text,
  "preview_status"           "media_url_preview_status" NOT NULL DEFAULT 'pending',
  "preview_generated_at"     timestamptz,
  "preview_expires_at"       timestamptz,
  "last_error"               text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "media_urls_user_idx"      ON "media_urls" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "media_urls_user_type_idx" ON "media_urls" ("user_id", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "media_urls_user_hash_uq" ON "media_urls" ("user_id", "url_hash");
