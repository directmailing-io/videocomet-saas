-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0061: Meta CAPI Event-Log
--
-- Für jedes an die Meta Conversions API gesendete Event legen wir eine Row an
-- (append-only). Das Admin-Dashboard zeigt die Timeline, damit wir sehen, ob
-- Events wirklich rausgehen, welche User betroffen sind und wo Meta ablehnt.
--
-- Was NICHT geloggt wird: die gehashten PII-Felder (em/ph/fn/ln) — die sind
-- schon beim User im Klartext, hash-Kopie brächte nichts. Wir speichern nur
-- Event-Name, User-ID (wenn bekannt), Wert/Currency, Response-Status,
-- Fehlermeldung, Timestamp.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "meta_event_log" (
  "id"             bigserial PRIMARY KEY,
  "event_name"     text NOT NULL,
  "event_id"       text NOT NULL,
  "user_id"        uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "user_email"     text,
  "value"          numeric(12, 2),
  "currency"       text,
  "action_source"  text NOT NULL,
  "source_url"     text,
  "http_status"    smallint,
  "ok"             boolean NOT NULL,
  "error"          text,
  "sent_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "meta_event_log_sent_at_idx"
  ON "meta_event_log" ("sent_at" DESC);

CREATE INDEX IF NOT EXISTS "meta_event_log_user_idx"
  ON "meta_event_log" ("user_id") WHERE "user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "meta_event_log_event_name_idx"
  ON "meta_event_log" ("event_name", "sent_at" DESC);

COMMIT;
