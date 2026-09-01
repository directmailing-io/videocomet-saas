-- Site-Analytics: eigene Mini-Übersicht für videocomet.de (Marketing-
-- Website). First-Party, keine Cookies, keine Drittanbieter.
-- Session-ID kommt aus sessionStorage im Browser (nicht persistent).
-- IP wird gehasht (SHA256+Salt aus TRACKING_SECRET) — für grobe
-- Unique-Visitor-Schätzung ohne die Klar-IP zu speichern.

CREATE TABLE IF NOT EXISTS "site_events" (
  "id" bigserial PRIMARY KEY,
  "session_id" text NOT NULL,
  -- 'page_view' | 'click' | 'session_start' | (weiteres bei Bedarf)
  "event_name" text NOT NULL,
  "path" text,
  "referrer" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "utm_term" text,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "site_events_ts_idx"
  ON "site_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "site_events_session_ts_idx"
  ON "site_events" ("session_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "site_events_name_ts_idx"
  ON "site_events" ("event_name", "created_at" DESC);
