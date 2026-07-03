-- Migration 0030 — Globale Kontakte-Ansicht + DSGVO-Hard-Delete
--
-- Zwei zusammenhängende Features:
--   1. Duplikat-Detection über alle Kampagnen eines Users hinweg
--      (normalisierte E-Mail/Name als generated columns + user-scoped
--      match config).
--   2. DSGVO-konforme Hard-Delete: Audit-Log der Löschung + Cleanup-Reihe
--      auf webhookDeliveries + crmEventLog die bisher SET NULL cascaden.

BEGIN;

-- ── 1. Generated Columns auf leads für Match-Vergleich ──────────────────
-- Postgres generated columns werden bei jedem Insert/Update neu berechnet
-- und indexbar. Wir extrahieren die relevanten Felder aus leads.data
-- (JSONB) und normalisieren sie einmal fuer alle Dedupe-Queries.
--
-- normalized_email:  lowercase + trim, extrahiert aus data.email
-- normalized_name:   lowercase + trim, "vorname nachname" (space separator)
-- normalized_company: lowercase + trim + strip Legal-Suffixe

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "normalized_email" text
    GENERATED ALWAYS AS (
      lower(trim(COALESCE(
        data->>'email',
        data->>'Email',
        data->>'E-Mail',
        data->>'eMail'
      )))
    ) STORED;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "normalized_name" text
    GENERATED ALWAYS AS (
      NULLIF(
        lower(trim(
          COALESCE(data->>'firstName', data->>'Vorname', data->>'vorname', '')
          || ' ' ||
          COALESCE(data->>'lastName',  data->>'Nachname', data->>'nachname', '')
        )),
        ' '
      )
    ) STORED;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "normalized_company" text
    GENERATED ALWAYS AS (
      NULLIF(
        regexp_replace(
          lower(trim(COALESCE(
            data->>'company',
            data->>'companyName',
            data->>'Firma',
            data->>'firma',
            data->>'Unternehmen',
            ''
          ))),
          '\s+(gmbh|ug|ag|kg|ohg|ltd|llc|inc|sarl|s\.?a\.?|s\.?r\.?l\.?)\s*$',
          '',
          'i'
        ),
        ''
      )
    ) STORED;

-- Indices — nur wo Werte sind (partial indices sparen Platz bei
-- Leads ohne die Felder).
CREATE INDEX IF NOT EXISTS "leads_normalized_email_idx"
  ON "leads" ("normalized_email")
  WHERE "normalized_email" IS NOT NULL AND "removed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "leads_normalized_name_idx"
  ON "leads" ("normalized_name")
  WHERE "normalized_name" IS NOT NULL AND "removed_at" IS NULL;

-- ── 2. User-scoped Kontakt-Match-Regeln ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_lead_match_config" (
  "user_id"        uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "config"         jsonb NOT NULL DEFAULT '{
    "autoMergeOnEmail": true,
    "suggestMergeOnNameCompany": true,
    "levenshteinThreshold": 2
  }'::jsonb,
  "updated_at"     timestamptz NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE "user_lead_match_config" IS
  'Pro User: welche Regeln bestimmen ob zwei Leads dieselbe Person sind.';

-- ── 3. DSGVO-Deletion-Audit ─────────────────────────────────────────────
-- Nach Art. 30 DSGVO muss dokumentiert werden WER WANN WAS geloescht hat.
-- Wir speichern einen Snapshot der wichtigsten Lead-Felder VOR dem Delete
-- damit im Streitfall (Abmahnung) belegbar ist was verarbeitet wurde.
--
-- Snapshot enthaelt bewusst KEINE PII mehr — nur Metadata (Kampagnen-ID,
-- Zeitpunkt, Grund). Wenn wir doch PII brauchen fuer Belege, ist das
-- eine separate legal-hold-Tabelle mit strengerem Zugriff.

CREATE TABLE IF NOT EXISTS "lead_deletion_audit" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lead_id"        uuid NOT NULL,   -- keine FK, weil der Lead ja weg ist
  "campaign_id"    uuid,
  "run_id"         uuid,
  "reason"         text NOT NULL,   -- 'user_request' | 'gdpr_dsar' | 'complaint'
  "meta"           jsonb,           -- optional: {slug, hadPdf, hadVideo, ...}
  "requested_by"   uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "lead_deletion_audit_user_idx"
  ON "lead_deletion_audit" ("user_id", "created_at" DESC);

COMMENT ON TABLE "lead_deletion_audit" IS
  'DSGVO-Art.30 Verzeichnis: welcher Lead wurde wann wieso geloescht.';

COMMIT;
