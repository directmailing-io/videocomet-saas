-- 0049: Intro-Staging — persistiertes Ergebnis der Intro-Generierung.
--
-- Die personalisierte Begrüßung wird nicht mehr inline im Render-Job
-- erzeugt, sondern in einer eigenen Queue VOR dem Render ("Staging").
-- Das Ergebnis landet als JSONB am Lead:
--   intro_result   { url, startTrimMs, firstName, generatedAt } | NULL
--                  → Bunny-URL des fertigen personalisierten Webcam-Videos;
--                    die Render-Pipeline lädt es nur noch herunter.
--   intro_attempts Zähler der Staging-Versuche (Watchdog-Grenze: 3).
--
-- intro_status bekommt zwei neue (nicht-terminale) Werte: 'queued' und
-- 'generating' — reine TEXT-Spalte, kein Enum-Alter nötig.
BEGIN;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "intro_result" jsonb;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "intro_attempts" integer NOT NULL DEFAULT 0;

COMMIT;
