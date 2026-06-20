-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0025: Outgoing-Webhooks (Phase A — Datenlayer)
--
-- Zweck:
--   Kunden können pro Account und/oder pro Kampagne Webhook-Endpunkte
--   konfigurieren, an die VideoComet Event-Payloads (lead.opened,
--   lead.video_played, lead.video_progress, lead.cta_clicked, lead.created,
--   run.completed, run.failed) als HTTP-POST signiert ausliefert. Diese
--   Migration legt nur Tabellen + Indizes an — Worker, Queue und Routes
--   kommen in den parallelen Phasen.
--
-- Datenmodell:
--   webhook_endpoints     Endpoint-Konfiguration des Users
--                          (URL, HMAC-Secret, aktivierte Events,
--                          optionale Custom-Header, scope per
--                          campaign_id ODER NULL = account-weit).
--   webhook_deliveries    Append-only Audit-Log aller Delivery-Versuche
--                          (Payload, HTTP-Status, Retry-State).
--
-- Sicherheits-Invarianten:
--   - `url` darf nur `http(s)://` schemata zulassen (CHECK-Constraint
--     `webhook_endpoints_url_https_chk`). Privates-Netz-Blocking, SSRF-
--     Schutz und DNS-Pinning passieren in `src/lib/webhooks/url-guard.ts`
--     beim Erstellen UND vor jeder Delivery (Defense-in-Depth vs.
--     DNS-Rebinding).
--   - `secret` ist NOT NULL — Phase A erzeugt es serverseitig (csprng);
--     der Klartext wird dem User EINMAL angezeigt. Für die Signatur-
--     Berechnung (`signature.ts`) bleibt der Wert im Klartext in der DB
--     liegen (kein Roundtrip ins KMS — Worker braucht ihn pro Push),
--     wird aber nie über die API zurückgegeben.
--   - `enabled_events` ist eine JSON-Array der aktivierten
--     WebhookEventKinds. Leeres Array → kein Push.
--   - `custom_headers` ist ein JSON-Object aus zusätzlich zu sendenden
--     Headern (z.B. statisches Auth-Token gegen ein Webhook-Relay).
--     Verboten sind `X-VideoComet-*`-Header — der Validator in der Route
--     filtert das.
--   - Unique `(user_id, name)` damit der Kunde mehrere Endpoints halten
--     kann („Zapier Prod" + „Make Staging"), ohne Namens-Kollision.
--   - `consecutive_failures` + `disabled_at`/`disabled_reason` werden vom
--     Worker nach N aufeinanderfolgenden Fehlversuchen gesetzt
--     (Soft-Disable) und vom UI als Banner angezeigt.
--   - `webhook_deliveries.event_id` ist der `evt_…`-Identifier aus dem
--     Payload und ermöglicht Empfängern Idempotenz. Index auf
--     `(endpoint_id, event_id)` für schnelle Dedupe-Lookups.
--
-- Reversibel: zwei isolierte Tabellen + Indizes, keine Änderung am
-- Bestandsschema. Rollback-Block am Dateiende (commented out).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  enabled_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  disabled_reason text,
  consecutive_failures smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_delivery_ok boolean,
  last_delivery_error text,
  CONSTRAINT webhook_endpoints_user_name_uq UNIQUE (user_id, name),
  CONSTRAINT webhook_endpoints_url_https_chk CHECK (url ~* '^https?://')
);
CREATE INDEX webhook_endpoints_user_idx ON webhook_endpoints(user_id);
CREATE INDEX webhook_endpoints_campaign_active_idx
  ON webhook_endpoints(campaign_id) WHERE active = true;
CREATE INDEX webhook_endpoints_user_active_account_idx
  ON webhook_endpoints(user_id) WHERE campaign_id IS NULL AND active = true;

CREATE TABLE webhook_deliveries (
  id bigserial PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  event_id text NOT NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  request_headers jsonb,
  http_status smallint,
  response_body text,
  error_message text,
  attempt smallint NOT NULL DEFAULT 1,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_endpoint_ts_idx
  ON webhook_deliveries(endpoint_id, ts DESC);
CREATE INDEX webhook_deliveries_retry_idx
  ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;
CREATE INDEX webhook_deliveries_event_id_idx
  ON webhook_deliveries(endpoint_id, event_id);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Rollback (Ops, NICHT für Drizzle):
--
-- BEGIN;
-- DROP INDEX IF EXISTS webhook_deliveries_event_id_idx;
-- DROP INDEX IF EXISTS webhook_deliveries_retry_idx;
-- DROP INDEX IF EXISTS webhook_deliveries_endpoint_ts_idx;
-- DROP TABLE IF EXISTS webhook_deliveries;
-- DROP INDEX IF EXISTS webhook_endpoints_user_active_account_idx;
-- DROP INDEX IF EXISTS webhook_endpoints_campaign_active_idx;
-- DROP INDEX IF EXISTS webhook_endpoints_user_idx;
-- DROP TABLE IF EXISTS webhook_endpoints;
-- COMMIT;
-- ──────────────────────────────────────────────────────────────────────────
