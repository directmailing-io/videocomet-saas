-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0014: Campaign-scoped Slugs
--
-- Bisher waren Lead-Slugs entweder global eindeutig (default) oder pro
-- Custom-Domain eindeutig (Migration 0004). Beides wird hier durch einen
-- saubereren Scope ersetzt: **Slug-Eindeutigkeit pro Campaign**.
--
-- Hintergrund: Mehrere Kampagnen desselben Kunden dürfen denselben Slug
-- (z.B. „max-mustermann") liefern, weil sie unterschiedlichen Use-Cases
-- dienen. Mit campaign-scoped Slugs werden Kollisionen nur dort verhindert
-- wo es weh tut: innerhalb derselben Kampagne, optional weiter ge-narrowt
-- nach Domain für Custom-Domain-Kampagnen.
--
-- Schritte:
--   1. `leads.campaign_id` als NULLABLE ADD COLUMN.
--   2. Backfill aus `runs.campaign_id` (idempotent: setzt nur leere).
--   3. NOT NULL + FK CASCADE.
--   4. Alte slug-Unique-Indices droppen.
--   5. Neue partial Unique-Indices auf (campaign_id, [domain_id,] slug).
--   6. `campaigns.slug_suffix` als optionaler Tenant-Suffix (^[a-z0-9-]{1,32}$).
--
-- Idempotenz: ADD COLUMN IF NOT EXISTS, DROP INDEX IF EXISTS,
-- CREATE INDEX IF NOT EXISTS, Backfill UPDATE filtert auf `IS NULL`.
-- Wenn 0014 mehrfach läuft, ändert sich nach dem ersten erfolgreichen Lauf
-- nichts mehr.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) leads.campaign_id NULLABLE anlegen ─────────────────────────────────
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "campaign_id" uuid;

-- ── 2) Backfill aus runs.campaign_id ──────────────────────────────────────
-- Nur dort schreiben, wo noch NULL ist → re-runs sind harmlos.
UPDATE "leads"
   SET "campaign_id" = "runs"."campaign_id"
  FROM "runs"
 WHERE "leads"."run_id" = "runs"."id"
   AND "leads"."campaign_id" IS NULL;

-- ── 3) NOT NULL + FK ──────────────────────────────────────────────────────
-- Falls Tabelle leer oder Backfill bereits durchgelaufen, ist das ein No-op.
ALTER TABLE "leads"
  ALTER COLUMN "campaign_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_campaign_id_fk'
  ) THEN
    ALTER TABLE "leads"
      ADD CONSTRAINT "leads_campaign_id_fk"
      FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "leads_campaign_idx"
  ON "leads" ("campaign_id");

-- ── 4) Alte slug-Unique-Indices entfernen ─────────────────────────────────
DROP INDEX IF EXISTS "leads_default_slug_uq";
DROP INDEX IF EXISTS "leads_custom_slug_uq";

-- ── 5) Neue campaign-scoped partial Unique-Indices ────────────────────────
-- Default: Slug pro Kampagne eindeutig (für Standard-app.videocomet.de-LP).
CREATE UNIQUE INDEX IF NOT EXISTS "leads_campaign_default_slug_uq"
  ON "leads" ("campaign_id", "slug")
  WHERE "domain_id" IS NULL AND "slug" IS NOT NULL;

-- Custom-Domain: Slug pro Kampagne UND Domain eindeutig.
CREATE UNIQUE INDEX IF NOT EXISTS "leads_campaign_custom_slug_uq"
  ON "leads" ("campaign_id", "domain_id", "slug")
  WHERE "domain_id" IS NOT NULL AND "slug" IS NOT NULL;

-- ── 6) campaigns.slug_suffix ──────────────────────────────────────────────
-- Optionaler Tenant-Suffix, z.B. „/v/max-mustermann-q4" mit suffix `q4`.
-- Format-Sanity per CHECK-Constraint: lowercase, alphanum, dash, max 32.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "slug_suffix" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_slug_suffix_check'
  ) THEN
    ALTER TABLE "campaigns"
      ADD CONSTRAINT "campaigns_slug_suffix_check"
      CHECK ("slug_suffix" IS NULL OR "slug_suffix" ~ '^[a-z0-9-]{1,32}$');
  END IF;
END$$;

COMMIT;
