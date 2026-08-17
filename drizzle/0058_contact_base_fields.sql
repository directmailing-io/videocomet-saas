-- Migration 0058 — Erweiterung der Basis-Kontakt-Felder
--
-- Bisher hatte `contacts` nur: email, firstName, lastName, company,
-- companyDisplay, phone, linkedinUrl. Alles andere landete im `data`-
-- jsonb als Custom-Field — das führt zu Duplikaten wie "vorname"+
-- "Vorname" oder "plz"+"PLZ", weil Kunden aus verschiedenen Quellen
-- importieren.
--
-- Neu als Standard-Basis-Felder:
--   salutation   Anrede (Herr/Frau/Dr./…)
--   title        Titel (Dr., Prof., …)
--   external_id  Externe ID vom Import (z. B. "L-220" aus CRM)
--   street       Straße + Hausnummer
--   postal_code  PLZ
--   city         Ort
--   country      Land
--   position     Position/Rolle im Unternehmen
--   website      Firmen-Website
--   gender       Geschlecht (freier String: m/w/d oder wie der Kunde importiert)
--
-- Rückwärts-Migration der Bestandsdaten: für jeden Contact werden die
-- typischen Varianten aus data-jsonb gehoben und danach aus dem jsonb
-- entfernt, damit das Custom-Fields-Panel keine Duplikate mehr zeigt.

BEGIN;

-- ── 1. Neue Spalten ────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS salutation  text,
  ADD COLUMN IF NOT EXISTS title       text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS street      text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city        text,
  ADD COLUMN IF NOT EXISTS country     text,
  ADD COLUMN IF NOT EXISTS position    text,
  ADD COLUMN IF NOT EXISTS website     text,
  ADD COLUMN IF NOT EXISTS gender      text;

-- ── 2. Indizes (nur die nützlichen) ────────────────────────────────────
-- external_id für spätere Dedupe-Suche per Kunden-ID
CREATE INDEX IF NOT EXISTS "contacts_user_external_id_idx"
  ON "contacts" ("user_id", "external_id")
  WHERE "external_id" IS NOT NULL AND "deleted_at" IS NULL;

-- ── 3. Backfill aus data-jsonb ─────────────────────────────────────────
-- Wir übernehmen typische Varianten der Feld-Namen (deutsch + englisch).
-- Wenn beide Spalte UND jsonb-Key existieren, gewinnt der jsonb-Wert
-- (weil der frischer sein kann — der Backfill hier läuft ja nur einmal).

UPDATE contacts SET
  salutation = COALESCE(salutation,
    data->>'Anrede', data->>'anrede', data->>'Salutation', data->>'salutation'),
  title = COALESCE(title,
    data->>'Titel', data->>'titel', data->>'Title', data->>'title'),
  external_id = COALESCE(external_id,
    data->>'ID', data->>'id', data->>'External-ID', data->>'ExternalId', data->>'external_id'),
  street = COALESCE(street,
    data->>'Straße', data->>'strasse', data->>'strae', data->>'Strasse',
    data->>'Straße + Nr.', data->>'Adresse', data->>'adresse',
    data->>'Street', data->>'street'),
  postal_code = COALESCE(postal_code,
    data->>'PLZ', data->>'plz', data->>'Postleitzahl',
    data->>'Postal-Code', data->>'postal_code', data->>'Zip', data->>'zip'),
  city = COALESCE(city,
    data->>'Ort', data->>'ort', data->>'Stadt', data->>'stadt',
    data->>'City', data->>'city'),
  country = COALESCE(country,
    data->>'Land', data->>'land', data->>'Country', data->>'country'),
  position = COALESCE(position,
    data->>'Position', data->>'position', data->>'Rolle', data->>'rolle',
    data->>'Job-Titel', data->>'jobTitle', data->>'Job Title'),
  website = COALESCE(website,
    data->>'Website', data->>'website', data->>'Webseite', data->>'webseite',
    data->>'Web', data->>'Website-URL', data->>'website_url', data->>'URL'),
  gender = COALESCE(gender,
    data->>'Geschlecht', data->>'geschlecht', data->>'Geschl.',
    data->>'Gender', data->>'gender', data->>'Sex')
WHERE deleted_at IS NULL;

-- ── 4. Migrierte Keys aus data-jsonb entfernen ─────────────────────────
-- Damit die "Weitere Felder"-Ansicht nicht die Duplikate zeigt und der
-- User nicht denkt, er hätte 30 Custom-Felder.
UPDATE contacts SET
  data = data
    - 'Anrede' - 'anrede' - 'Salutation' - 'salutation'
    - 'Titel' - 'titel' - 'Title' - 'title'
    - 'ID' - 'id' - 'External-ID' - 'ExternalId' - 'external_id'
    - 'Straße' - 'strasse' - 'strae' - 'Strasse'
    - 'Straße + Nr.' - 'Adresse' - 'adresse'
    - 'Street' - 'street'
    - 'PLZ' - 'plz' - 'Postleitzahl'
    - 'Postal-Code' - 'postal_code' - 'Zip' - 'zip'
    - 'Ort' - 'ort' - 'Stadt' - 'stadt'
    - 'City' - 'city'
    - 'Land' - 'land' - 'Country' - 'country'
    - 'Position' - 'position' - 'Rolle' - 'rolle'
    - 'Job-Titel' - 'jobTitle' - 'Job Title'
    - 'Website' - 'website' - 'Webseite' - 'webseite'
    - 'Web' - 'Website-URL' - 'website_url' - 'URL'
    - 'Geschlecht' - 'geschlecht' - 'Geschl.'
    - 'Gender' - 'gender' - 'Sex',
  updated_at = now()
WHERE deleted_at IS NULL;

-- ── 5. Sanity-Report ──────────────────────────────────────────────────
DO $$
DECLARE
  v_updated int;
BEGIN
  SELECT COUNT(*) INTO v_updated FROM contacts WHERE deleted_at IS NULL;
  RAISE NOTICE '[0058] Basis-Felder aufgeräumt: % Contacts verarbeitet', v_updated;
END $$;

COMMIT;
