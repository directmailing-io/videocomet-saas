-- Migration 0029 — Slug-Alias-Tabelle + HEX-Suffix-Backfill
--
-- Ziel: Cross-Campaign-Slug-Collision auf Custom-Domains verhindern
-- (Bug 2026-07-03: `video.digispace.at/markus-oberdacher` liefert falsches
--  Video wenn zwei Kampagnen desselben Users denselben Lead-Namen enthalten).
--
-- Strategie:
--   1. Alle bestehenden Leads bekommen einen frischen HEX-Suffix an ihren Slug.
--   2. Der alte Slug wird als ALIAS gespeichert — gedruckte QR-Codes/Briefe die
--      auf `/markus-oberdacher` zeigen finden ihren Lead weiterhin.
--   3. Neuer Slug-Generator (Code) haengt IMMER einen HEX-Suffix an — auch
--      bei Erst-Insert. Damit sind Kollisionen physisch unmoeglich (65k
--      Kombinationen pro Namenskombination).
--
-- Alias-Tabelle wird auch fuer zukuenftige Faelle genutzt: wenn ein Kunde
-- einen Lead umbenennt oder loescht+neu-hinzufuegt, wird der alte Slug fuer
-- 90 Tage als Alias gehalten. Danach 410 Gone.

BEGIN;

-- ── 1. Alias-Tabelle ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "lead_slug_aliases" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lead_id"     uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "slug"        text NOT NULL,
  "domain_id"   uuid REFERENCES "user_domains"("id") ON DELETE CASCADE,
  "expires_at"  timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT NOW()
);

-- Lookup-Index — muss schnell sein, wird von jeder Custom-Domain-Anfrage getroffen.
CREATE INDEX IF NOT EXISTS "lead_slug_aliases_lookup_custom_idx"
  ON "lead_slug_aliases" ("domain_id", "slug")
  WHERE "domain_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "lead_slug_aliases_lookup_default_idx"
  ON "lead_slug_aliases" ("slug")
  WHERE "domain_id" IS NULL;

COMMENT ON TABLE "lead_slug_aliases" IS
  'Alte Lead-Slugs die auf einen aktuellen Lead zeigen. Verhindert Link-Rot fuer gedruckte QR-Codes bei Slug-Aenderungen (Rename, HEX-Suffix-Backfill).';

-- ── 2. Backfill: bestehende Slugs archivieren + neuen HEX-Suffix vergeben ──
--
-- Wir gehen wie folgt vor:
--   a) Fuer jeden Lead mit Slug: Original in aliases speichern.
--   b) Slug ueberschreiben mit `<originalslug>-<hex4>`. Random ist OK weil
--      wir per Lead-ID einen deterministisch reproduzierbaren HEX brauchen.
--      Nutzen substring des lead_id-uuid — kollisionsfrei innerhalb (domainId,
--      campaignId), was den bestehenden UNIQUE-Constraints reicht.
--
-- Der 4-char Suffix leitet sich aus lead.id ab (erste 4 hex chars). uuid
-- hat 32 hex chars, davon 4 sind fuer 65k Kombos gut genug.

-- Erst archivieren
INSERT INTO "lead_slug_aliases" ("lead_id", "slug", "domain_id", "expires_at")
SELECT
  l.id,
  l.slug,
  l.domain_id,
  NOW() + INTERVAL '90 days'
FROM "leads" l
WHERE l.slug IS NOT NULL
  AND NOT EXISTS (
    -- Idempotent: wenn Migration teilweise durchlief, nicht duplizieren
    SELECT 1 FROM "lead_slug_aliases" a
    WHERE a.lead_id = l.id AND a.slug = l.slug
  );

-- Dann Slugs updaten mit HEX-Suffix.
-- HEX kommt aus den ersten 4 Chars der lead.id (uuid) — deterministisch,
-- kollisionsarm bei ~1746 Leads (Geburtstagsparadoxon vernachlaessigbar).
UPDATE "leads"
SET slug = slug || '-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 4)
WHERE slug IS NOT NULL
  -- Idempotent: wenn Slug schon einen 4-hex-Suffix hat, nicht nochmal.
  -- Match: irgendwas + '-' + 4 hex chars am Ende.
  AND slug !~ '-[0-9a-f]{4}$';

-- ── 3. Nicht-fatal: falls das Backfill-Update einen UNIQUE-Constraint
-- verletzt (nur bei extrem seltenem Zufalls-Kollisions-Pattern), fangen
-- wir das nicht ab — die Migration schlaegt dann fehl und wir muessen
-- den betroffenen Datensatz manuell fixen. Bei 1746 Leads und 65k
-- Suffix-Raum ist die Wahrscheinlichkeit unter 0.03%.

COMMIT;
