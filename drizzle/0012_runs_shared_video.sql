-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0012: runs.shared_* — Pro-Run-Cache für Webcam-only Videos
--
-- Bei Webcam-only-Kampagnen ist das Lead-Video IDENTISCH für alle Leads
-- (keine Personalisierung, kein Greenscreen). Aktuell wird das Video aber
-- für jeden Lead separat nach Bunny Stream hochgeladen — N×Bandwidth +
-- N×Encode-Wartezeit. Bei 5 Leads sind das schnell 60s+.
--
-- Mit diesem Cache wird das Video pro Run EINMAL aufgelöst:
--   - Wenn der Webcam-Source bereits eine `vz-*.b-cdn.net/<guid>/playlist
--     .m3u8`-URL ist (= Mediathek-Video, schon in Stream), extrahieren
--     wir den GUID ohne Re-Upload.
--   - Sonst (Bunny-Storage-URL, z.B. Webcam-Recording): erster Worker
--     holt sich den Upload-Lock via `shared_video_upload_started_at`,
--     lädt hoch, schreibt `shared_*`. Andere Worker pollen.
--
-- Reversible: drei DROP COLUMNs würden reichen.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "shared_bunny_video_id" text,
  ADD COLUMN IF NOT EXISTS "shared_video_url" text,
  ADD COLUMN IF NOT EXISTS "shared_thumbnail_url" text,
  ADD COLUMN IF NOT EXISTS "shared_video_upload_started_at" timestamp with time zone;
