-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0017: Soft-Delete für Custom-LP-Versions (Paket G)
--
-- Hintergrund: bisher hat ein DELETE auf eine Custom-LP-Version den Storage-
-- Pfad invalidiert, während Runs noch darauf pinnen → Pipeline lief ins
-- Leere (`version.storagePath` NULL → 502 beim Render). Mit dieser Spalte
-- werden Versionen statt physisch gelöscht nur als `deleted_at` markiert;
-- der Editor (list-Queries) filtert sie raus, gepinnte Render-Queries
-- (`getCustomLpContextBySlug…`) lesen weiterhin den Storage-Pfad — d.h.
-- Bestand-Runs bleiben heile.
--
-- Idempotenz: `ADD COLUMN IF NOT EXISTS`.
-- Reversibel: `ALTER TABLE custom_lp_versions DROP COLUMN deleted_at`.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "custom_lp_versions"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- Partial Index für die List-Query, die `deleted_at IS NULL` filtert. Ohne
-- Partial-Index müsste Postgres jedes Mal über alle weichgelöschten Rows
-- joinen.
CREATE INDEX IF NOT EXISTS "custom_lp_versions_active_idx"
  ON "custom_lp_versions" ("template_id", "version")
  WHERE "deleted_at" IS NULL;

COMMIT;
