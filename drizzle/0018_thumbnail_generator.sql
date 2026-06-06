-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0018: Thumbnail-Generator (Paket A)
--
-- Hintergrund: Kampagnen sollen ein Thumbnail-Slide ähnlich dem Folien-Slide
-- konfigurieren können (Background + Layers). Wenn das Thumbnail-Template
-- Platzhalter enthält, wird pro Lead ein eigenes Thumbnail-Bild gerendert;
-- ohne Platzhalter rendert die Pipeline EIN Bild pro Run und teilt es über
-- alle Leads (Cache).
--
-- Spalten:
--   campaigns.thumbnail_image_enabled  bool  — Feature-Toggle pro Kampagne
--   campaigns.thumbnail_image          jsonb — { background, layers[] }
--   leads.custom_thumbnail_url         text  — pro-Lead-gerendertes Bild
--                                              (Bunny-Storage-URL)
--   runs.shared_thumbnail_url          text  — Run-weites Cache-Bild,
--                                              wenn das Template KEINE
--                                              Platzhalter enthält. NOTE:
--                                              die Spalte existiert bereits
--                                              seit Migration 0012 (für die
--                                              Webcam-only-Optimierung). Der
--                                              ADD ... IF NOT EXISTS ist ein
--                                              No-op auf Bestands-DBs; wir
--                                              dokumentieren die Wieder-
--                                              verwendung explizit.
--
-- Idempotenz: `ADD COLUMN IF NOT EXISTS`.
-- Reversibel: drei DROP COLUMNs (für `runs.shared_thumbnail_url` nur, wenn
-- 0012 ebenfalls rückgängig gemacht wird).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "thumbnail_image_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "thumbnail_image" jsonb;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "custom_thumbnail_url" text;

ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "shared_thumbnail_url" text;

COMMIT;
