-- Kontakt-Status als echtes Feld (kein Label): active | do_not_contact | undeliverable.
-- Harter Filter bei Runden-Start + E-Mail-Versand; Auto-Setzung durch
-- Abmeldelink (do_not_contact) und Bounce (undeliverable).
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "contacts_user_status_idx"
  ON "contacts" ("user_id", "status")
  WHERE "deleted_at" IS NULL AND "status" <> 'active';
