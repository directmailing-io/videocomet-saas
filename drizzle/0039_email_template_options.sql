-- Migration 0039 — E-Mail-Vorlagen-Optionen (Format + Signatur-Stufen)
--
-- Gruender-Entscheidung 2026-07-23:
--   format:      'branded' (600px-Layout, Button) | 'personal' (wie handgetippt)
--   footer_mode: 'complete' (Abmelden + Impressum) | 'unsubscribe' (nur Abmelden) | 'none'
--
-- impressum_html bleibt NOT NULL — leerer String ist erlaubt, wenn
-- footer_mode != 'complete' (Pflicht-Validierung nur bei 'complete',
-- siehe isEmailTemplateComplete in src/lib/db/queries/email-templates.ts).
--
-- RFC-8058 List-Unsubscribe-Header, Suppression-Liste, Bounce-Handling und
-- Klick-Tracking laufen unabhaengig vom footer_mode IMMER weiter.

BEGIN;

ALTER TABLE "email_templates"
  ADD COLUMN IF NOT EXISTS "format" text NOT NULL DEFAULT 'branded',
  ADD COLUMN IF NOT EXISTS "footer_mode" text NOT NULL DEFAULT 'complete';

COMMIT;
