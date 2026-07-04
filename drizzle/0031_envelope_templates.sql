-- Migration 0031 — Umschlag-Templates (Envelope Templates)
--
-- Neues Feature: pro Kampagne kann ein Umschlag-Layout gewaehlt werden.
-- Bei Rundenerstellung wird pro Lead ein personalisiertes Umschlag-PDF
-- generiert, das im Bundle-Export separat neben dem Brief-PDF liegt.
--
-- Analog zu customLpTemplates: user-scoped, mit fields-Array (JSONB),
-- der Position/Font/Content pro Textfeld beschreibt.

BEGIN;

-- Format-Enum
DO $$ BEGIN
  CREATE TYPE "envelope_format" AS ENUM ('DIN_LANG', 'C4', 'C5', 'C6');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. Envelope-Templates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "envelope_templates" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "format"      envelope_format NOT NULL DEFAULT 'DIN_LANG',
  -- fields: Array von {id, label, content, x, y, width, fontSize, lineHeight, font, color}
  -- x/y/width in Prozent (0..100) vom Umschlag-Format,
  -- fontSize in pt, lineHeight als Multiplikator (1.0-4.0),
  -- font: 'LiebeHeideFineliner' | 'BiroScript' | 'Helvetica' (Fallback),
  -- color: Hex '#RRGGBB'.
  "fields"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Absender-Angaben werden im Feld-Content als {{__sender.line1}} etc. referenziert
  -- ODER als statischer Text direkt in fields. Wir speichern sie extra fuer bequeme UI.
  "sender"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "deleted_at"  timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "envelope_templates_user_idx"
  ON "envelope_templates" ("user_id")
  WHERE "deleted_at" IS NULL;

COMMENT ON TABLE "envelope_templates" IS
  'Umschlag-Vorlagen pro User. Speichert Format + Text-Feld-Positionen + Absender.';

-- ── 2. campaigns.envelope_template_id ──────────────────────────────────
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "envelope_template_id" uuid
    REFERENCES "envelope_templates"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "campaigns_envelope_template_idx"
  ON "campaigns" ("envelope_template_id")
  WHERE "envelope_template_id" IS NOT NULL;

-- ── 3. leads.envelope_pdf_url ──────────────────────────────────────────
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "envelope_pdf_url" text,
  ADD COLUMN IF NOT EXISTS "envelope_pdf_expires_at" timestamptz;

COMMIT;
