-- Abspielquote als Anteil der einmalig gesehenen Zeitleiste (2026-09-03).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "watch_pct" integer NOT NULL DEFAULT 0;
