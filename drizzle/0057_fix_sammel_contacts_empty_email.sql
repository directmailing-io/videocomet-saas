-- Migration 0057 — Nachbesserung zu 0056: Sammel-Contacts richtig erkennen
--
-- Bug in Migration 0056: WHERE-Bedingung `AND c.email IS NULL` fand die
-- Sammel-Contacts nicht, weil deren `email`-Feld beim Backfill in 0054
-- mit dem leeren String belegt wurde (nicht NULL) — genau der Bug, den
-- 0056 fixen sollte, hatte die 0056-Bedingung selbst verschluckt.
--
-- Fix: `AND COALESCE(c.email, '') = ''` — matcht sowohl NULL als auch ''.
-- Rest der 0056-Logik unverändert nachziehen.

BEGIN;

CREATE TEMP TABLE _bug_leads ON COMMIT DROP AS
  SELECT l.id AS lead_id, l.contact_id AS old_contact_id
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
   WHERE l.removed_at IS NULL
     AND l.normalized_email IS NULL
     AND COALESCE(c.email, '') = ''
     AND l.normalized_name IS NOT NULL
     AND l.normalized_company IS NOT NULL
     AND (
       lower(coalesce(c.first_name,'')) <> split_part(l.normalized_name, ' ', 1)
       OR lower(coalesce(c.last_name,''))  <> substr(l.normalized_name, position(' ' in l.normalized_name)+1)
       OR lower(coalesce(c.company,''))    <> l.normalized_company
     );

UPDATE leads SET contact_id = NULL
 WHERE id IN (SELECT lead_id FROM _bug_leads);

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

INSERT INTO contacts (id, user_id, email, first_name, last_name, company, company_display, phone, linkedin_url, data, created_at, updated_at, last_activity_at)
SELECT
  gc.contact_id, master.user_id, NULL,
  master.first_name_raw, master.last_name_raw,
  master.company_norm, master.company_raw,
  master.phone_raw, master.linkedin_raw, master.data,
  master.last_seen, master.last_seen, master.last_seen
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
    ng.data, ng.last_seen
  FROM _new_groups ng
  WHERE ng.user_id = gc.user_id AND ng.group_key = gc.group_key
  ORDER BY ng.last_seen DESC NULLS LAST, ng.lead_id
  LIMIT 1
) master ON TRUE;

UPDATE leads l
   SET contact_id = gc.contact_id
  FROM _new_groups ng
  JOIN _new_group_contacts gc
    ON gc.user_id = ng.user_id AND gc.group_key = ng.group_key
 WHERE l.id = ng.lead_id;

-- Alte Sammel-Contacts aufräumen (jetzt mit korrekter Bedingung)
UPDATE contacts
   SET deleted_at = now(),
       deleted_reason = 'orphan_after_0057_fix',
       updated_at = now()
 WHERE id IN (SELECT DISTINCT old_contact_id FROM _bug_leads)
   AND NOT EXISTS (
     SELECT 1 FROM leads l
      WHERE l.contact_id = contacts.id
        AND l.removed_at IS NULL
   );

DO $$
DECLARE
  v_new int; v_re int; v_orph int;
BEGIN
  SELECT COUNT(*) INTO v_new FROM _new_group_contacts;
  SELECT COUNT(*) INTO v_re  FROM _bug_leads;
  SELECT COUNT(*) INTO v_orph FROM contacts WHERE deleted_reason = 'orphan_after_0057_fix';
  RAISE NOTICE '[0057] Relinked: %, neue Contacts: %, aufgeräumte Sammel-Contacts: %',
    v_re, v_new, v_orph;
END $$;

COMMIT;
