-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0009: Pro-User-fortlaufende numeric_id auf webcam_share_links
--
-- Zweck: Jeder Share-Link bekommt zusätzlich zum Slug eine dreistellige ID,
-- die der User im UI sehen kann ("#003"). Damit lässt sich ein in der
-- Mediathek eintreffendes Video sofort dem Link zuordnen, ohne den langen
-- Slug abzulesen.
--
-- Invarianten:
--   - numeric_id ist pro User aufsteigend (1, 2, 3, …), startet bei 1.
--   - Eindeutigkeit ist NUR pro user_id garantiert (zwei User dürfen
--     beide eine #001 haben).
--   - Bestands-Rows werden nach created_at ASC durchnummeriert.
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Spalte zunächst nullable hinzufügen, damit Backfill möglich ist.
ALTER TABLE "webcam_share_links" ADD COLUMN "numeric_id" integer;
--> statement-breakpoint

-- 2. Backfill: pro User die Rows nach created_at sortieren und 1..N
--    durchnummerieren. row_number() ist deterministisch über partition.
UPDATE "webcam_share_links" AS w
SET "numeric_id" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
  FROM "webcam_share_links"
) AS sub
WHERE w.id = sub.id;
--> statement-breakpoint

-- 3. Nicht-Null + Default-1 setzen (Default greift nur bei
--    Backwards-Compat-Insert ohne explizite ID — wir setzen sie immer
--    selbst).
ALTER TABLE "webcam_share_links" ALTER COLUMN "numeric_id" SET NOT NULL;
--> statement-breakpoint

-- 4. UNIQUE pro (user_id, numeric_id) — verhindert Race-Condition-Doppler.
CREATE UNIQUE INDEX "webcam_share_links_user_numeric_uq"
  ON "webcam_share_links" ("user_id", "numeric_id");
