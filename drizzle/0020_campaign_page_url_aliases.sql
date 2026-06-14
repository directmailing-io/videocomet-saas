-- Migration 0020: campaigns.page_url_aliases
--
-- User koennen pro Kampagne eigene Platzhalter-Namen festlegen, die als
-- {{Landingpage-URL}} interpretiert werden sollen. Kommasepariert, z.B.
-- "lp,unsere-url,link-zur-seite". Case-insensitive Lookup.
-- Built-in Aliase (pageUrl, landingpage-url, uname, ...) bleiben weiter
-- gueltig — die User-Liste ergaenzt sie nur.

BEGIN;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "page_url_aliases" text;

COMMIT;
