-- Aufnahme-Links: optionales Format-Preset (2026-09-03).
-- 'landscape' | 'portrait' | NULL (Gast waehlt selbst).
ALTER TABLE "webcam_share_links" ADD COLUMN IF NOT EXISTS "orientation" text;
ALTER TABLE "webcam_share_links" DROP CONSTRAINT IF EXISTS "webcam_share_links_orientation_check";
ALTER TABLE "webcam_share_links" ADD CONSTRAINT "webcam_share_links_orientation_check"
  CHECK ("orientation" IS NULL OR "orientation" IN ('landscape', 'portrait'));
