-- Migration 0028 — Source-Tracking auf runs-Tabelle
--
-- Ziel: eine "Runde" weiss ab jetzt, aus welcher Quelle sie kommt.
-- Motivation: Multi-Tab-Google-Sheets-Import — 1 Sheet mit N Tabs erzeugt
-- N Runden. Ohne source-tracking wuerde jede spawned Runde ihre Herkunft
-- verlieren. Zusaetzlich: enables Re-Import-Feature.
--
-- Vier neue Spalten, alle nullable, komplett additiv. Bestehende Runden
-- bekommen NULL — kein Backfill noetig. Kein UNIQUE, kein CHECK.

ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "source_type" text,
  ADD COLUMN IF NOT EXISTS "source_url" text,
  ADD COLUMN IF NOT EXISTS "source_tab_gid" integer,
  ADD COLUMN IF NOT EXISTS "source_tab_title" text;

-- Optionaler Constraint auf source_type — begrenzt Werte auf bekannte Kinds.
-- Wenn's je erweitert wird (parquet, notion, …) einfach hier ergaenzen.
DO $$ BEGIN
  ALTER TABLE "runs"
    ADD CONSTRAINT "runs_source_type_check"
    CHECK ("source_type" IS NULL OR "source_type" IN ('csv', 'xlsx', 'google-sheets'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index fuer Re-Import-Query "welche Runden kommen aus diesem Sheet?"
CREATE INDEX IF NOT EXISTS "runs_source_url_idx"
  ON "runs" ("source_url")
  WHERE "source_type" = 'google-sheets';

COMMENT ON COLUMN "runs"."source_type"
  IS 'Herkunft der Leadliste: csv, xlsx, google-sheets. NULL = pre-Migration/legacy.';
COMMENT ON COLUMN "runs"."source_url"
  IS 'Original-URL (Google Sheets) oder Dateiname (fuer csv/xlsx).';
COMMENT ON COLUMN "runs"."source_tab_gid"
  IS 'Google Sheets gid — stabile Tab-ID pro Tab-Lifetime.';
COMMENT ON COLUMN "runs"."source_tab_title"
  IS 'Tab-Titel-Snapshot beim Import — Bleibt lesbar wenn Tab spaeter umbenannt/geloescht.';
