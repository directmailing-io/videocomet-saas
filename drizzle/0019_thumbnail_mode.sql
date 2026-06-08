-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0019: Thumbnail-Modus (Paket A)
--
-- Erweitert die Thumbnail-Konfiguration einer Kampagne um zwei Felder:
--
--   campaigns.thumbnail_mode       text   — Single-Source-of-Truth, in welcher
--                                           Form das Vorschaubild im PDF-Brief
--                                           erzeugt wird:
--                                             • 'frame'                  → Standbild aus dem Video
--                                             • 'custom_image'           → personalisierte Folie (Editor)
--                                             • 'landingpage_screenshot' → Auto-Screenshot der
--                                                                          gerenderten Lead-LP
--
--   campaigns.thumbnail_play_icon  bool   — Globales Overlay-Toggle: zeigt
--                                           einen halbtransparenten Play-Button
--                                           über dem Thumbnail (gilt für alle
--                                           drei Modi gleichermaßen).
--
-- Backfill: bestehende Kampagnen mit `thumbnail_image_enabled = true`
-- bekommen `thumbnail_mode = 'custom_image'`. Alle anderen behalten den
-- Default 'frame' — das spiegelt das bisherige Verhalten (zwei Modi,
-- gesteuert über `thumbnail_image_enabled`).
--
-- `thumbnail_image_enabled` bleibt als computed mirror bestehen, damit
-- bestehender Pipeline-Code (Paket B/C, noch nicht migriert) weiter
-- funktioniert. Die Frontend-Logik setzt das Feld konsistent zum Modus.
--
-- Idempotenz: `ADD COLUMN IF NOT EXISTS` + `DO $$ … pg_constraint`-Block
-- für die CHECK-Constraint, damit Re-Runs der Migration nicht failen.
-- Reversibel: drei DROPs (CHECK-Constraint + beide Spalten).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "thumbnail_mode" text NOT NULL DEFAULT 'frame',
  ADD COLUMN IF NOT EXISTS "thumbnail_play_icon" boolean NOT NULL DEFAULT false;

-- Backfill: bestehende Kampagnen, die die Folie nutzten, behalten ihren
-- Modus. Idempotent — bei Re-Run sind Werte schon korrekt.
UPDATE "campaigns"
SET "thumbnail_mode" = 'custom_image'
WHERE "thumbnail_image_enabled" = true
  AND "thumbnail_mode" = 'frame';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_thumbnail_mode_check'
  ) THEN
    ALTER TABLE "campaigns"
      ADD CONSTRAINT "campaigns_thumbnail_mode_check"
      CHECK ("thumbnail_mode" IN ('frame', 'custom_image', 'landingpage_screenshot'));
  END IF;
END$$;

COMMIT;
