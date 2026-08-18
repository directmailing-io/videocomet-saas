-- 0062: Neuer bunny_asset_refs-Owner-Typ 'campaign_media'.
--
-- Kontext (2026-08-18): PDF-Segment-Dateien (Original-PDF + Seiten-PNGs)
-- und Canva-PPTX-Uploads lagen bisher UNGETRACKT in Bunny Storage — beim
-- Löschen einer Kampagne blieben sie für immer liegen. Ab jetzt hält jede
-- Kampagne Refs auf ihre Storage-Dateien (Owner 'campaign_media'); der
-- Sync läuft bei jedem Segment-Save, das Campaign-DELETE entfernt die
-- Refs und der Purge-Worker räumt die Dateien ab.

ALTER TABLE "bunny_asset_refs"
  DROP CONSTRAINT IF EXISTS "bunny_asset_refs_owner_type_check";

ALTER TABLE "bunny_asset_refs"
  ADD CONSTRAINT "bunny_asset_refs_owner_type_check"
  CHECK ("owner_type" IN ('lead','run','media_item','campaign_webcam','campaign_media'));
