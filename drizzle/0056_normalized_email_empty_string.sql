-- Migration 0056 — Bug-Fix: leerer String vs NULL in normalized_email
--
-- Bug (Migration 0030): die generated column `leads.normalized_email` gibt
-- bei fehlenden E-Mails den leeren String zurück (nicht NULL), weil
-- `NULLIF(..., '')` fehlt. Konsequenz: Backfill 0054 gruppierte in Stufe 1
-- (E-Mail-Merge) alle Leads mit leerer E-Mail unter demselben group_key
-- 'e:' zusammen und legte pro User genau EINEN Sammel-Contact an — dem
-- 427 fremde Leads hingen (echter Kunden-Fall: „Dieter Hoyer" bekam 143
-- Fremd-Leads, „Fabienne Stalder" 284).
--
-- Fix:
--   1) Generated Column neu definieren mit NULLIF → leerer String wird
--      zu NULL. Alle Bestandsdaten werden dabei automatisch neu berechnet.
--      Index neu erstellen (DROP COLUMN killt ihn mit).
--   2) Alle Leads, die aktuell auf einen "Sammel-Contact" zeigen (der laut
--      neuer NULL-Logik gar keine E-Mail-Identität mehr hat, aber trotzdem
--      >1 Lead trägt), von diesem Contact lösen: contact_id = NULL.
--   3) Diese losen Leads dreistufig neu konsolidieren (analog Backfill in
--      0054): Stufe 2 name+company → eigene Contacts, Stufe 3 orphan.
--   4) Verwaiste Sammel-Contacts (0 verbleibende Leads) soft-löschen.

BEGIN;

-- ── 1. Generated Column umbauen ────────────────────────────────────────
-- Der Index hängt am alten Column-Definition; wir droppen ihn zuerst,
-- danach die Column, dann alles neu anlegen. Postgres berechnet die
-- Column für alle Rows automatisch neu.

DROP INDEX IF EXISTS "leads_normalized_email_idx";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "normalized_email";

ALTER TABLE "leads"
  ADD COLUMN "normalized_email" text
    GENERATED ALWAYS AS (
      NULLIF(
        lower(trim(COALESCE(
          data->>'email',
          data->>'Email',
          data->>'E-Mail',
          data->>'eMail'
        ))),
        ''
      )
    ) STORED;

CREATE INDEX "leads_normalized_email_idx"
  ON "leads" ("normalized_email")
  WHERE "normalized_email" IS NOT NULL AND "removed_at" IS NULL;

-- ── 2. Betroffene Leads von Sammel-Contacts lösen ──────────────────────
-- Nach dem Column-Rebuild ist normalized_email für die Bug-Leads NULL,
-- der contact_id zeigt aber noch auf den Sammel-Contact. Wir identifizieren
-- diese Zuordnungen und setzen contact_id = NULL.
--
-- Definition Sammel-Contact = Contact ohne eigene E-Mail, der als Master
-- für Leads dient, deren normalized_email jetzt NULL ist und deren
-- normalized_name/company vom Contact-Master abweicht.

CREATE TEMP TABLE _bug_leads ON COMMIT DROP AS
  SELECT l.id AS lead_id, l.contact_id AS old_contact_id
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
   WHERE l.removed_at IS NULL
     AND l.normalized_email IS NULL             -- keine echte Email
     AND c.email IS NULL                        -- Contact hat auch keine
     AND l.normalized_name IS NOT NULL          -- aber Name+Firma vorhanden
     AND l.normalized_company IS NOT NULL
     AND (
       -- Contact-Name weicht vom Lead-Name ab (Fremd-Lead)
       lower(coalesce(c.first_name,'')) <> split_part(l.normalized_name, ' ', 1)
       OR lower(coalesce(c.last_name,''))  <> substr(l.normalized_name, position(' ' in l.normalized_name)+1)
       OR lower(coalesce(c.company,''))    <> l.normalized_company
     );

-- Ausgewählte Leads von ihrem falschen Contact lösen
UPDATE leads SET contact_id = NULL
 WHERE id IN (SELECT lead_id FROM _bug_leads);

-- ── 3. Diese losen Leads neu konsolidieren (Backfill-Logik aus 0054) ──

CREATE TEMP TABLE _new_groups ON COMMIT DROP AS
  SELECT
    l.id AS lead_id,
    r.user_id,
    CASE
      WHEN l.normalized_name IS NOT NULL AND l.normalized_company IS NOT NULL
        THEN 'n:' || l.normalized_name || '|' || l.normalized_company
      ELSE 'l:' || l.id::text
    END AS group_key,
    l.data,
    COALESCE(l.completed_at, l.created_at) AS last_seen
    FROM leads l
    JOIN runs r ON r.id = l.run_id
   WHERE l.id IN (SELECT lead_id FROM _bug_leads);

CREATE TEMP TABLE _new_group_contacts ON COMMIT DROP AS
  SELECT g.user_id, g.group_key, gen_random_uuid() AS contact_id
    FROM (SELECT DISTINCT user_id, group_key FROM _new_groups) g;

-- Master-Contacts für jede neue Gruppe anlegen (jüngster Lead = Master)
INSERT INTO contacts (id, user_id, email, first_name, last_name, company, company_display, phone, linkedin_url, data, created_at, updated_at, last_activity_at)
SELECT
  gc.contact_id,
  master.user_id,
  NULL,  -- normalized_email ist definitionsgemäß NULL
  master.first_name_raw,
  master.last_name_raw,
  master.company_norm,
  master.company_raw,
  master.phone_raw,
  master.linkedin_raw,
  master.data,
  master.last_seen,
  master.last_seen,
  master.last_seen
FROM _new_group_contacts gc
JOIN LATERAL (
  SELECT
    ng.user_id,
    (SELECT normalized_company FROM leads WHERE id = ng.lead_id) AS company_norm,
    COALESCE(ng.data->>'firstName', ng.data->>'Vorname', ng.data->>'vorname') AS first_name_raw,
    COALESCE(ng.data->>'lastName',  ng.data->>'Nachname', ng.data->>'nachname') AS last_name_raw,
    COALESCE(ng.data->>'company', ng.data->>'companyName', ng.data->>'Firma', ng.data->>'firma') AS company_raw,
    COALESCE(ng.data->>'phone', ng.data->>'Telefon', ng.data->>'telefon') AS phone_raw,
    COALESCE(ng.data->>'linkedin', ng.data->>'linkedinUrl', ng.data->>'LinkedIn') AS linkedin_raw,
    ng.data,
    ng.last_seen
  FROM _new_groups ng
  WHERE ng.user_id = gc.user_id AND ng.group_key = gc.group_key
  ORDER BY ng.last_seen DESC NULLS LAST, ng.lead_id
  LIMIT 1
) master ON TRUE;

-- Leads den neuen Contacts zuordnen
UPDATE leads l
   SET contact_id = gc.contact_id
  FROM _new_groups ng
  JOIN _new_group_contacts gc
    ON gc.user_id = ng.user_id AND gc.group_key = ng.group_key
 WHERE l.id = ng.lead_id;

-- ── 4. Alte Sammel-Contacts aufräumen ─────────────────────────────────
-- Contacts ohne verbleibende aktive Leads → soft-löschen
UPDATE contacts
   SET deleted_at = now(),
       deleted_reason = 'orphan_after_0056_fix',
       updated_at = now()
 WHERE id IN (SELECT DISTINCT old_contact_id FROM _bug_leads)
   AND NOT EXISTS (
     SELECT 1 FROM leads l
      WHERE l.contact_id = contacts.id
        AND l.removed_at IS NULL
   );

-- ── 5. Sanity-Report ──────────────────────────────────────────────────
DO $$
DECLARE
  v_new_contacts int;
  v_relinked int;
  v_orphaned int;
BEGIN
  SELECT COUNT(*) INTO v_new_contacts FROM _new_group_contacts;
  SELECT COUNT(*) INTO v_relinked FROM _bug_leads;
  SELECT COUNT(*) INTO v_orphaned FROM contacts WHERE deleted_reason = 'orphan_after_0056_fix';
  RAISE NOTICE '[0056] Bug-Leads: %, neue Contacts: %, aufgeräumte Sammel-Contacts: %',
    v_relinked, v_new_contacts, v_orphaned;
END $$;

COMMIT;
