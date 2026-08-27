-- Migration 0067: Versandzentrale — Brief-Versandstatus pro Lead.
-- Status wechselt NIE automatisch (nur explizite User-Aktion), damit
-- Test-Exporte statistik-neutral bleiben.

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "letter_status" text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "letter_sent_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "letter_exported_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "letter_planned_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "letter_returned_at" timestamptz;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_letter_status_check"
  CHECK ("letter_status" IN ('open', 'in_progress', 'sent'));

CREATE INDEX IF NOT EXISTS "leads_letter_status_idx"
  ON "leads" ("run_id", "letter_status");

-- E-Mail an Auswahl: explizite Lead-Auswahl pro Blast (NULL = alle).
ALTER TABLE "email_blasts"
  ADD COLUMN IF NOT EXISTS "lead_ids" jsonb;
