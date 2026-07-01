-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0027: Billing — Subscription + Credit-Ledger + Stripe-Webhooks
--
-- Zweck:
--   Einführung des Credit-basierten Bezahlsystems. User zahlen 40€/Monat
--   für Plattform-Zugang (separat) und kaufen Credits zur Video-Generation
--   (1 Credit = 1€ netto = 1 Video). Credit-Bewegungen werden in einem
--   append-only Ledger geführt; die UI-Balance ist ein Cache auf der
--   users-Tabelle, den wir transaktional zum Ledger fortschreiben.
--
-- Sicherheits-Invarianten:
--   - users.credit_balance >= 0 (CHECK), Defense-in-Depth gegen Bug-induced
--     Negativ-Balances. Worker-Code muss vorher prüfen + locken.
--   - credit_tx_lead_charge_uq verhindert Doppel-Charge pro Lead bei
--     Worker-Retry (auch wenn videoAlreadyDone-Flag mal fehlschlägt).
--   - credit_tx_stripe_event_uq verhindert Doppel-Top-Up bei Webhook-Replay.
--   - stripe_webhook_events.id ist PRIMARY KEY (Idempotenz-Gate).
--
-- Lifecycle:
--   - User wird via Admin-Invite angelegt: credit_balance=0, subscription=NULL
--   - Self-Activation via Stripe-Checkout: subscription_status='active',
--     stripe_customer_id + stripe_subscription_id gesetzt
--   - Credit-Kauf via Top-Up-Checkout: INSERT credit_transactions (topup)
--     + UPDATE users.credit_balance
--   - Video-Generation: INSERT credit_transactions (video_charge)
--     + UPDATE users.credit_balance (in derselben Transaktion mit FOR UPDATE)
-- ──────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM (
    'active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "credit_tx_kind" AS ENUM (
    'topup', 'video_charge', 'admin_adjust', 'promo_grant'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Users-Tabelle erweitern
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text,
  ADD COLUMN IF NOT EXISTS "subscription_status" "subscription_status",
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text,
  ADD COLUMN IF NOT EXISTS "subscription_current_period_end" timestamptz,
  ADD COLUMN IF NOT EXISTS "credit_balance" integer NOT NULL DEFAULT 0;

-- Defense-in-Depth: Cache-Balance darf nie negativ werden.
DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_credit_balance_nonneg_chk"
    CHECK (credit_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "users_stripe_customer_idx"
  ON "users" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;

-- 2) Credit-Transactions (append-only Ledger)
CREATE TABLE IF NOT EXISTS "credit_transactions" (
  "id"                bigserial PRIMARY KEY,
  "user_id"           uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"              "credit_tx_kind" NOT NULL,
  "delta"             integer NOT NULL,
  "balance_after"     integer NOT NULL,
  "lead_id"           uuid REFERENCES "leads"("id") ON DELETE SET NULL,
  "run_id"            uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "stripe_event_id"   text,
  "stripe_ref"        text,
  "admin_user_id"     uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason"            text,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "credit_tx_user_ts_idx"
  ON "credit_transactions" ("user_id", "created_at" DESC);

-- Partial-Unique: 1 video_charge pro Lead max → idempotent gegen Worker-Retry.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_tx_lead_charge_uq"
  ON "credit_transactions" ("lead_id")
  WHERE "kind" = 'video_charge';

-- Partial-Unique: 1 topup pro Stripe-Event max → idempotent gegen Webhook-Replay.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_tx_stripe_event_uq"
  ON "credit_transactions" ("stripe_event_id")
  WHERE "kind" = 'topup' AND "stripe_event_id" IS NOT NULL;

-- 3) Stripe-Webhook-Events (Idempotenz-Tabelle)
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id"             text PRIMARY KEY,
  "type"           text NOT NULL,
  "payload"        jsonb NOT NULL,
  "processed_at"   timestamptz,
  "error_message"  text,
  "received_at"    timestamptz NOT NULL DEFAULT now()
);
