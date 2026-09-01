-- Kosten-Ledger: pro Video-Job-Schritt (Fish TTS, sync.so Lipsync, ...)
-- geloggte External-API-Kosten in Micro-EUR (1_000_000 = 1 €). Micro
-- statt Cent, weil Fish/sync.so Sub-Cent-Präzision haben und wir
-- korrekt summieren wollen ohne Rundungsfehler. Fire-and-forget: das
-- Logging blockiert nie die Pipeline, Fehler werden geschluckt.

CREATE TABLE IF NOT EXISTS "cost_events" (
  "id" bigserial PRIMARY KEY,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
  -- 'intro_tts' (Fish Audio) | 'intro_lipsync' (sync.so) | 'other'
  "kind" text NOT NULL,
  -- Positiver Betrag in Micro-EUR (1_000_000 = 1 €). Immer >= 0.
  "amount_micro_eur" bigint NOT NULL,
  -- Freies Meta (z.B. { chars: 156 } für TTS, { seconds: 8.4 } für Lipsync).
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Standard-Report-Queries: per User + Zeitraum, per Run, per Kind.
CREATE INDEX IF NOT EXISTS "cost_events_user_ts_idx"
  ON "cost_events" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cost_events_run_idx"
  ON "cost_events" ("run_id");
CREATE INDEX IF NOT EXISTS "cost_events_campaign_ts_idx"
  ON "cost_events" ("campaign_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cost_events_kind_ts_idx"
  ON "cost_events" ("kind", "created_at" DESC);
