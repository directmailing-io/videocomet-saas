-- Migration 0055 — API-Keys für Automation-Zugriff (Mini-CRM Etappe 6b)
--
-- Externe Systeme (Zapier / Make / n8n / eigene Skripte) melden sich per
-- Bearer-Token bei /api/v1/lists/:id/contacts an. Der Klartext-Key wird
-- dem User beim Erstellen EINMAL angezeigt und danach nur als bcrypt-Hash
-- gespeichert.
--
-- Rate-Limit erfolgt applikationsseitig auf `last_used_at`-Basis (kein
-- separater Zähler-Table nötig für den Anfang).
--
-- Idempotency-Keys werden pro API-Key in einem sliding-Window (24h) im
-- gleichen Table gespeichert (jsonb — kein 3. Table für den Anfang).

BEGIN;

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- Klartext-Prefix zum Wiedererkennen im UI ("vc_live_xxxx…") — die
  -- ersten 12 Zeichen sind sichtbar, der Rest ist gehasht.
  "name"            text NOT NULL,
  "key_prefix"      text NOT NULL,   -- z.B. "vc_live_a1b2" (12 chars)
  "key_hash"        text NOT NULL,   -- sha256(key) hex

  "last_used_at"    timestamptz,
  "usage_count"     integer NOT NULL DEFAULT 0,

  -- Idempotency-Keys der letzten 24h (jsonb-Array von {key, response_json, at}).
  -- Wenn derselbe Idempotency-Key erneut kommt, geben wir die alte Response
  -- zurück statt den Contact doppelt anzulegen. Wird nächtlich getrimmt.
  "recent_idempotency" jsonb NOT NULL DEFAULT '[]'::jsonb,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "revoked_at"      timestamptz
);

CREATE INDEX IF NOT EXISTS "api_keys_user_idx"
  ON "api_keys" ("user_id")
  WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_uq"
  ON "api_keys" ("key_hash");

COMMIT;
