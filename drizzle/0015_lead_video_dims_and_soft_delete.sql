-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0015: Lead-Video-Dims + Soft-Delete + Shared-Video-State
--
-- Drei orthogonale Erweiterungen, gebündelt damit Paket A in einem Sprint
-- durchläuft:
--
--   1. `leads.video_*` — gecachte Video-Dimensionen + finale MP4-URL pro
--      Lead. Vom Bunny-Resolver beim Finalize einmal berechnet und hier
--      gepinned, damit Player + PDF-Thumbnail-Pipeline nicht jedesmal die
--      Bunny-Stream-API anfragen müssen.
--
--   2. `campaigns.deleted_at` / `runs.deleted_at` — Soft-Delete-Marker.
--      Wir patchen die existierenden Queries hier NICHT (das ist Paket G).
--      Spalten sind NULL für alle Bestände — kein Verhaltens-Drift.
--
--   3. `runs.shared_video_state` — Lifecycle-State-Machine für das
--      pro-Run-geteilte Webcam-Video. Ergänzt die in Migration 0012
--      eingeführten `shared_*`-Spalten um einen sauber observierbaren
--      Zustand (`pending → compressing → uploading → ready`, oder
--      `failed`). Default `pending` für alle Bestände.
--
-- Idempotenz: ADD COLUMN IF NOT EXISTS + CHECK-Constraints via DO-Block.
-- Reversibel: ALTER TABLE … DROP COLUMN für alle neuen Spalten.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Lead-Video-Dims ────────────────────────────────────────────────────
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "video_width"  integer,
  ADD COLUMN IF NOT EXISTS "video_height" integer,
  ADD COLUMN IF NOT EXISTS "video_orientation" text,
  ADD COLUMN IF NOT EXISTS "video_mp4_url" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_video_orientation_check'
  ) THEN
    ALTER TABLE "leads"
      ADD CONSTRAINT "leads_video_orientation_check"
      CHECK ("video_orientation" IS NULL
             OR "video_orientation" IN ('landscape','portrait','square'));
  END IF;
END$$;

-- ── 2) Soft-Delete für campaigns + runs ───────────────────────────────────
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- ── 3) runs.shared_video_state ────────────────────────────────────────────
ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "shared_video_state" text
    NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'runs_shared_video_state_check'
  ) THEN
    ALTER TABLE "runs"
      ADD CONSTRAINT "runs_shared_video_state_check"
      CHECK ("shared_video_state" IN
             ('pending','compressing','uploading','ready','failed'));
  END IF;
END$$;

COMMIT;
