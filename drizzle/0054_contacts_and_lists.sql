-- Migration 0054 — Kontakte, Listen & Custom-Feld-Definitionen (Mini-CRM Etappe 1)
--
-- Konzept-Pitch: /tmp/videocomet-pitch-mini-crm.html
--
-- Ziel: Kontakte werden nicht mehr nur run-scoped erzeugt, sondern globale
-- Entitäten, die in beliebigen Listen zusammengefasst und über Runs hinweg
-- referenziert werden. Basis für spätere Etappen (Detailansicht, Filter,
-- Import-UX, Auto-Kampagne bei Neuzugang).
--
-- Dieser Schritt macht NUR das Datenmodell + Backfill der bestehenden
-- Leads → Contacts. UI, Import, Filter, API kommen in Etappen 2-6.
--
-- ── Neue Tabellen ──────────────────────────────────────────────────────
--   contacts               Master-Entität pro User+Person
--   contact_lists          Behälter (static | smart)
--   list_memberships       n:m Contact <-> Liste (mit Herkunft)
--   contact_fields         Meta zu Custom-Feldern (Label, erkannter Typ)
--
-- ── Änderungen an bestehendem Schema ───────────────────────────────────
--   leads.contact_id       FK auf contacts (nullable — alte Runs bleiben lesbar)
--
-- ── Backfill ───────────────────────────────────────────────────────────
--   Pro User werden alle nicht-gelöschten Leads gruppiert und je Gruppe
--   ein Contact angelegt. Master-Daten kommen vom neuesten Lead der
--   Gruppe. Gruppierungs-Schlüssel (in der Reihenfolge):
--     1. normalized_email (falls vorhanden — höchste Prio)
--     2. normalized_name + normalized_company (nur wenn beide vorhanden)
--     3. sonst: eigener Contact pro Lead (kein Merge)
--
--   Diese Heuristik entspricht der bestehenden `listContacts()`-Logik
--   in src/lib/leads/global-list.ts, damit die UI im nächsten Schritt
--   ohne Migration weiter gruppieren würde. NEU: die Gruppen werden
--   jetzt PERSISTIERT statt bei jedem Query neu berechnet.

BEGIN;

-- ── 1. contacts ────────────────────────────────────────────────────────
-- Master pro (userId, Kontakt-Identität). Basis-Felder als typisierte
-- Spalten (Email/Name/Firma), alles weitere im `data` jsonb.
CREATE TABLE IF NOT EXISTS "contacts" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- Normalisierte Basis-Felder (gleiche Regeln wie leads.normalized_*).
  -- Werden von der App gesetzt, nicht als generated columns (weil
  -- contacts.data die Quelle ist, nicht ein anderes JSONB).
  "email"           text,        -- normalized, lowercase, trimmed
  "first_name"      text,
  "last_name"       text,
  "company"         text,        -- normalized, ohne Legal-Suffixe
  "company_display" text,        -- Roh-Firmenname für Anzeige
  "phone"           text,
  "linkedin_url"    text,

  -- Alle weiteren Felder (Custom-Felder aus Import, Tags, etc.).
  -- Werte sind text; Custom-Feld-Meta (Label, erkannter Typ) liegt in
  -- contact_fields.
  "data"            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- DSGVO-Marker (Etappe 1 nur Vorbereitung — Betroffenen-Löschung kommt
  -- über bestehende leadDeletionAudit-Pfad, hier erweitert).
  "deleted_at"      timestamptz,
  "deleted_reason"  text,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "last_activity_at" timestamptz  -- redundant zu leads-Aggregaten, aber
                                  -- billig für „letzte Aktivität"-Sortierung
);

-- Indizes: user-scoped Suche, Merge-Detection, Sortierung
CREATE INDEX IF NOT EXISTS "contacts_user_idx"
  ON "contacts" ("user_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "contacts_user_email_idx"
  ON "contacts" ("user_id", "email")
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "contacts_user_name_company_idx"
  ON "contacts" ("user_id", "last_name", "first_name", "company")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "contacts_user_last_activity_idx"
  ON "contacts" ("user_id", "last_activity_at" DESC)
  WHERE "deleted_at" IS NULL;

-- Weiche Uniqueness auf (user_id, email): NULL-Emails erlaubt (mehrere
-- Kontakte ohne Mail möglich), aber wenn Email da ist, nur einmal.
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_user_email_uq"
  ON "contacts" ("user_id", "email")
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;

-- ── 2. contact_lists ───────────────────────────────────────────────────
-- Behälter für Kontakte. `type = 'static'` = manuelle Membership,
-- `type = 'smart'` = gespeicherter Filter, Memberships werden per
-- Nightly-Job / on-write aktualisiert (Etappe 4).
CREATE TABLE IF NOT EXISTS "contact_lists" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  "name"            text NOT NULL,
  "description"     text,

  "type"            text NOT NULL DEFAULT 'static',
  -- Nur bei smart: gespeicherte Filter-Definition. Format wird in
  -- Etappe 4 (Filter) festgelegt; hier als opake JSONB.
  "smart_filter"    jsonb,

  -- Optional: Kampagne, die bei jedem Neuzugang automatisch angestoßen wird.
  -- Wird in Etappe 6 (Automation) verdrahtet. Hier nur Feld anlegen.
  "auto_run_campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,

  -- Denormalisierter Zähler für UI (kein Sub-Query auf list_memberships).
  -- Wird bei add/remove per Trigger oder App-seitig gepflegt.
  "contact_count"   integer NOT NULL DEFAULT 0,

  -- Optional: Farbe/Emoji für UI-Kachel (kommt in Etappe 2).
  "color"           text,
  "icon"            text,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  -- Type-CHECK
  CONSTRAINT "contact_lists_type_check" CHECK ("type" IN ('static', 'smart'))
);

CREATE INDEX IF NOT EXISTS "contact_lists_user_idx"
  ON "contact_lists" ("user_id");

-- Name pro User eindeutig (verhindert doppelt „Zahnärzte Q4").
CREATE UNIQUE INDEX IF NOT EXISTS "contact_lists_user_name_uq"
  ON "contact_lists" ("user_id", "name");

-- ── 3. list_memberships ────────────────────────────────────────────────
-- n:m — welcher Contact ist in welcher Liste, und wie kam er rein.
CREATE TABLE IF NOT EXISTS "list_memberships" (
  "list_id"     uuid NOT NULL REFERENCES "contact_lists"("id") ON DELETE CASCADE,
  "contact_id"  uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "added_at"    timestamptz NOT NULL DEFAULT now(),
  "added_via"   text NOT NULL DEFAULT 'manual',
  -- Optional: user_id denormalisiert für Query-Perf ohne JOIN.
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  PRIMARY KEY ("list_id", "contact_id"),
  CONSTRAINT "list_memberships_added_via_check"
    CHECK ("added_via" IN ('manual', 'import', 'api', 'merge', 'filter', 'smart'))
);

-- Umgekehrter Index: „In welchen Listen ist Contact X?"
CREATE INDEX IF NOT EXISTS "list_memberships_contact_idx"
  ON "list_memberships" ("contact_id", "list_id");

CREATE INDEX IF NOT EXISTS "list_memberships_user_idx"
  ON "list_memberships" ("user_id");

-- ── 4. contact_fields ──────────────────────────────────────────────────
-- Meta-Registrierung für Custom-Felder. Werte selbst liegen in
-- contacts.data (String-jsonb). Diese Tabelle hilft der UI die Felder
-- als Spalten anzuzeigen und beim Import den erkannten Typ zu merken.
CREATE TABLE IF NOT EXISTS "contact_fields" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- Slug im data-jsonb (z.B. "praxis_groesse"). URL-safe, snake_case.
  "key"             text NOT NULL,
  -- Anzeige-Label ("Praxis-Größe").
  "label"           text NOT NULL,
  -- Aus dem Import erraten (Etappe 3): email | phone | url | text.
  -- Wird für Icons in der UI genutzt, KEINE Validierung.
  "detected_type"   text NOT NULL DEFAULT 'text',

  -- Wie oft benutzt (denormalisiert für UI-Sortierung „Meine wichtigsten
  -- Felder oben"). Wird bei Import inkrementiert.
  "usage_count"     integer NOT NULL DEFAULT 0,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "contact_fields_detected_type_check"
    CHECK ("detected_type" IN ('email', 'phone', 'url', 'text', 'number', 'date'))
);

CREATE INDEX IF NOT EXISTS "contact_fields_user_idx"
  ON "contact_fields" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "contact_fields_user_key_uq"
  ON "contact_fields" ("user_id", "key");

-- ── 5. leads.contact_id ────────────────────────────────────────────────
-- Verbindet einen Lead-Row mit seinem Master-Contact. Nullable — Bestandsleads
-- ohne konsolidierten Contact (z.B. weil weder email noch name+company
-- vorhanden) bleiben orphan. Neu erstellte Leads bekommen contact_id
-- ab Etappe 5 (neuer Import / Rundenstart aus Liste) direkt gesetzt.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid
    REFERENCES "contacts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "leads_contact_idx"
  ON "leads" ("contact_id")
  WHERE "contact_id" IS NOT NULL;

-- ── 6. Trigger: last_activity_at auf contacts pflegen ──────────────────
-- Wenn ein Lead-Aggregat sich ändert (viewCount/playCount/ctaClickCount
-- oder Zeitstempel), heben wir contacts.last_activity_at hoch.
CREATE OR REPLACE FUNCTION update_contact_last_activity()
RETURNS trigger AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    -- Nur wenn das neue Datum später ist als das gespeicherte.
    UPDATE "contacts"
       SET "last_activity_at" = GREATEST(
             COALESCE(NEW.last_viewed_at, NEW.last_cta_at, NEW.completed_at, now()),
             COALESCE("last_activity_at", 'epoch'::timestamptz)
           )
     WHERE "id" = NEW.contact_id
       AND (
         "last_activity_at" IS NULL
         OR COALESCE(NEW.last_viewed_at, NEW.last_cta_at, NEW.completed_at) > "last_activity_at"
       );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_activity_to_contact ON "leads";
CREATE TRIGGER trg_lead_activity_to_contact
  AFTER INSERT OR UPDATE OF last_viewed_at, last_cta_at, completed_at, contact_id
  ON "leads"
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_last_activity();

-- ── 7. Backfill — bestehende Leads → Contacts ──────────────────────────
-- Dreistufig, damit die Reihenfolge stabil ist:
--
--   (a) Alle Leads mit normalized_email → gruppiert nach (user_id, email).
--       Master-Contact-Daten kommen vom neuesten Lead der Gruppe.
--   (b) Alle verbliebenen Leads mit normalized_name + normalized_company
--       → gruppiert nach (user_id, name, company).
--   (c) Alle verbliebenen Leads → ein eigener Contact pro Lead (kein Merge).
--
-- Danach leads.contact_id für alle Leads der Gruppe setzen.
--
-- Wir gehen über runs → users, damit wir die user_id für den Contact
-- kennen (leads haben keine direkte user_id). removed_at IS NULL: keine
-- Soft-Delete-Leads berücksichtigen.

-- Temp-Tabelle mit (lead_id, user_id, group_key) für alle 3 Stufen.
CREATE TEMP TABLE _lead_groups (
  lead_id     uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  group_key   text NOT NULL,   -- 'e:<email>' | 'n:<name>|<company>' | 'l:<lead_id>'
  stage       smallint NOT NULL, -- 1=email, 2=name+company, 3=orphan
  data        jsonb NOT NULL,
  last_seen   timestamptz NOT NULL
) ON COMMIT DROP;

-- Stufe (a): normalized_email
INSERT INTO _lead_groups (lead_id, user_id, group_key, stage, data, last_seen)
SELECT
  l.id,
  r.user_id,
  'e:' || l.normalized_email,
  1,
  l.data,
  COALESCE(l.completed_at, l.created_at)
FROM "leads" l
JOIN "runs" r ON r.id = l.run_id
WHERE l.removed_at IS NULL
  AND l.normalized_email IS NOT NULL;

-- Stufe (b): normalized_name + normalized_company (nur wo Stufe a nicht griff)
INSERT INTO _lead_groups (lead_id, user_id, group_key, stage, data, last_seen)
SELECT
  l.id,
  r.user_id,
  'n:' || l.normalized_name || '|' || l.normalized_company,
  2,
  l.data,
  COALESCE(l.completed_at, l.created_at)
FROM "leads" l
JOIN "runs" r ON r.id = l.run_id
WHERE l.removed_at IS NULL
  AND l.normalized_email IS NULL
  AND l.normalized_name IS NOT NULL
  AND l.normalized_company IS NOT NULL;

-- Stufe (c): Rest — jeder Lead sein eigener Contact
INSERT INTO _lead_groups (lead_id, user_id, group_key, stage, data, last_seen)
SELECT
  l.id,
  r.user_id,
  'l:' || l.id::text,
  3,
  l.data,
  COALESCE(l.completed_at, l.created_at)
FROM "leads" l
JOIN "runs" r ON r.id = l.run_id
WHERE l.removed_at IS NULL
  AND l.normalized_email IS NULL
  AND (l.normalized_name IS NULL OR l.normalized_company IS NULL);

-- Pro Gruppe: Master-Contact anlegen (Daten vom neuesten Lead der Gruppe).
-- Wir cachen die Contact-ID pro Gruppe in einer weiteren Temp-Tabelle.
CREATE TEMP TABLE _group_contacts (
  user_id     uuid NOT NULL,
  group_key   text NOT NULL,
  contact_id  uuid NOT NULL,
  PRIMARY KEY (user_id, group_key)
) ON COMMIT DROP;

INSERT INTO _group_contacts (user_id, group_key, contact_id)
SELECT
  g.user_id,
  g.group_key,
  gen_random_uuid()
FROM (
  SELECT DISTINCT user_id, group_key FROM _lead_groups
) g;

-- Master-Daten je Gruppe: Row mit größtem last_seen gewinnt (window fn).
INSERT INTO "contacts" (
  id, user_id, email, first_name, last_name, company, company_display,
  phone, linkedin_url, data, created_at, updated_at, last_activity_at
)
SELECT
  gc.contact_id,
  master.user_id,
  master.email_norm,
  master.first_name_raw,
  master.last_name_raw,
  master.company_norm,
  master.company_raw,
  master.phone_raw,
  master.linkedin_raw,
  master.data,
  master.first_seen,
  master.last_seen,
  master.last_seen
FROM _group_contacts gc
JOIN LATERAL (
  SELECT
    lg.user_id,
    -- Nimm die normalisierten Felder direkt vom Master-Lead
    (SELECT normalized_email  FROM "leads" WHERE id = lg.lead_id) AS email_norm,
    (SELECT normalized_company FROM "leads" WHERE id = lg.lead_id) AS company_norm,
    -- Roh-Daten kommen aus dem data-jsonb des Master-Leads
    COALESCE(lg.data->>'firstName', lg.data->>'Vorname', lg.data->>'vorname') AS first_name_raw,
    COALESCE(lg.data->>'lastName',  lg.data->>'Nachname', lg.data->>'nachname') AS last_name_raw,
    COALESCE(lg.data->>'company', lg.data->>'companyName', lg.data->>'Firma', lg.data->>'firma') AS company_raw,
    COALESCE(lg.data->>'phone', lg.data->>'Telefon', lg.data->>'telefon') AS phone_raw,
    COALESCE(lg.data->>'linkedin', lg.data->>'linkedinUrl', lg.data->>'LinkedIn') AS linkedin_raw,
    lg.data,
    -- Ältester Zeitstempel der Gruppe
    (SELECT MIN(COALESCE(l2.created_at, l2.completed_at))
       FROM _lead_groups g2
       JOIN "leads" l2 ON l2.id = g2.lead_id
       WHERE g2.user_id = gc.user_id AND g2.group_key = gc.group_key) AS first_seen,
    -- Neuester Zeitstempel der Gruppe (dieser Row ist der Master)
    lg.last_seen
  FROM _lead_groups lg
  WHERE lg.user_id = gc.user_id
    AND lg.group_key = gc.group_key
  ORDER BY lg.last_seen DESC NULLS LAST, lg.lead_id
  LIMIT 1
) master ON TRUE;

-- Alle Leads der Gruppe: contact_id setzen
UPDATE "leads" l
   SET "contact_id" = gc.contact_id
  FROM _lead_groups g
  JOIN _group_contacts gc
    ON gc.user_id = g.user_id AND gc.group_key = g.group_key
 WHERE l.id = g.lead_id;

-- ── 8. Sanity-Check ────────────────────────────────────────────────────
-- Loggt (per RAISE NOTICE) wie viele Contacts angelegt und wie viele Leads
-- verknüpft wurden. Prüft in Prod-Logs sichtbar.
DO $$
DECLARE
  v_contacts_created  integer;
  v_leads_linked      integer;
  v_leads_orphan      integer;
BEGIN
  SELECT COUNT(*) INTO v_contacts_created FROM "contacts";
  SELECT COUNT(*) INTO v_leads_linked FROM "leads" WHERE contact_id IS NOT NULL;
  SELECT COUNT(*) INTO v_leads_orphan
    FROM "leads"
   WHERE contact_id IS NULL AND removed_at IS NULL;
  RAISE NOTICE '[0054] Contacts created: %, Leads linked: %, Leads orphan (removed=NULL): %',
    v_contacts_created, v_leads_linked, v_leads_orphan;
END $$;

COMMIT;
