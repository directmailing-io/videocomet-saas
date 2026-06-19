-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0024: CRM-Integration (Phase 1 — Datenlayer)
--
-- Zweck:
--   Kunden können pro Account beliebig viele CRM-Integrationen anbinden
--   (HubSpot, Salessuite, Close). Eine Kampagne wählt genau eine Integration
--   aus + konfiguriert dort, wie Leads gematcht werden (`lead_match`) und
--   welche Lead-Events nach drüben gepusht werden (`enabled_events` +
--   `field_mapping`). Der eigentliche Push läuft in Phase 2 als Worker —
--   diese Migration legt nur Tabellen + Indizes an.
--
-- Datenmodell:
--   crm_integrations         Eine Connection-Konfiguration pro User
--                            (Provider + Name + verschlüsselter API-Key
--                            + zuletzt-Test-Ergebnis).
--   campaign_crm_settings    Genau ein Eintrag pro Kampagne mit der zu
--                            verwendenden Integration + Mapping.
--   crm_event_log            Append-only Audit-Log aller Push-Versuche
--                            zur CRM-Seite (für Debug & Re-Run-Diagnose).
--
-- Sicherheits-Invarianten:
--   - `api_key_encrypted` wird via AES-256-GCM mit `CRM_KEY_SECRET` codiert
--     (Format `iv:authTag:ciphertext` base64). `api_key_hint` speichert
--     nur die letzten 4 Zeichen für UI-Anzeige.
--   - Provider-Whitelist als CHECK-Constraint (`hubspot|salessuite|close`).
--   - Unique `(user_id, name)` damit Kunde mehrere Connections pro Provider
--     halten kann („HubSpot Acme" + „HubSpot DemoLab"), ohne Namens-Kollision.
--   - `campaign_crm_settings.crm_integration_id` mit ON DELETE RESTRICT —
--     eine genutzte Integration darf nicht versehentlich gelöscht werden;
--     die Route muss erst die Kampagnen umkonfigurieren.
--   - `crm_event_log` mit ON DELETE SET NULL für `lead_id` und
--     `integration_id` — Log überlebt das Löschen der referenzierten Rows
--     (z.B. für nachträgliche Audit-Anfragen).
--
-- Reversibel: drei isolierte Tabellen + Indizes, keine Änderung am
-- Bestandsschema. Rollback-Block am Dateiende (commented out).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE crm_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('hubspot','salessuite','close')),
  name text NOT NULL,
  api_key_encrypted text NOT NULL,
  api_key_hint text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  disabled_at timestamptz,
  CONSTRAINT crm_integrations_user_name_uq UNIQUE (user_id, name)
);
CREATE INDEX crm_integrations_user_idx ON crm_integrations(user_id);

CREATE TABLE campaign_crm_settings (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  crm_integration_id uuid NOT NULL REFERENCES crm_integrations(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  lead_match jsonb NOT NULL,
  enabled_events jsonb NOT NULL DEFAULT '["page_view","video_play","cta_click"]'::jsonb,
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_event_log (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  integration_id uuid REFERENCES crm_integrations(id) ON DELETE SET NULL,
  event_kind text NOT NULL,
  lookup_field text,
  lookup_value text,
  contact_id text,
  http_status smallint,
  request_body jsonb,
  response_body jsonb,
  error_message text,
  attempt smallint NOT NULL DEFAULT 1,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_event_log_campaign_ts_idx ON crm_event_log(campaign_id, ts DESC);
CREATE INDEX crm_event_log_lead_idx ON crm_event_log(lead_id);
CREATE INDEX crm_event_log_integration_idx ON crm_event_log(integration_id, ts DESC);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Rollback (Ops, NICHT für Drizzle):
--
-- BEGIN;
-- DROP INDEX IF EXISTS crm_event_log_integration_idx;
-- DROP INDEX IF EXISTS crm_event_log_lead_idx;
-- DROP INDEX IF EXISTS crm_event_log_campaign_ts_idx;
-- DROP TABLE IF EXISTS crm_event_log;
-- DROP TABLE IF EXISTS campaign_crm_settings;
-- DROP INDEX IF EXISTS crm_integrations_user_idx;
-- DROP TABLE IF EXISTS crm_integrations;
-- COMMIT;
-- ──────────────────────────────────────────────────────────────────────────
