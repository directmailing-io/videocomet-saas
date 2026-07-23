-- Migration 0038 — E-Mail-Outreach Fundament (Step 1)
--
-- Versand ausschliesslich ueber das eigene Postfach des Kunden:
-- M365 via Graph API ODER generisches SMTP (Versand) + IMAP (Rueckkanal).
-- Kontrakt: docs/email-outreach-implementation.md — Namen sind FIX.
--
-- Legt ALLE Outreach-Tabellen an (auch die von Step 2/3 genutzten), damit
-- spaetere Steps nur noch Code liefern.

-- ALTER TYPE ... ADD VALUE bewusst ausserhalb der Transaktion (Postgres
-- erlaubt die Nutzung neuer Enum-Werte nicht in derselben Transaktion).
ALTER TYPE credit_tx_kind ADD VALUE IF NOT EXISTS 'email_charge';
ALTER TYPE credit_tx_kind ADD VALUE IF NOT EXISTS 'email_refund';

BEGIN;

-- ── 1. mailbox_connections ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mailbox_connections" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- 'm365' | 'smtp'
  "provider"                 text NOT NULL,
  -- lowercase persistiert
  "email_address"            text NOT NULL,
  "display_name"             text,
  -- 'connected' | 'token_expired' | 'disabled'
  "status"                   text NOT NULL DEFAULT 'connected',
  -- m365: MS rotiert Refresh-Tokens => nach JEDEM Refresh neu persistieren
  "refresh_token_encrypted"  text,
  "smtp_host"                text,
  "smtp_port"                integer,
  -- true = 465 implizit TLS, false = 587 STARTTLS
  "smtp_secure"              boolean,
  "imap_host"                text,
  "imap_port"                integer DEFAULT 993,
  "username"                 text,
  "password_encrypted"       text,
  -- Explizites Opt-in (UI "Erweitert") — sonst strikte TLS-Pruefung
  "allow_invalid_tls"        boolean NOT NULL DEFAULT false,
  -- Hard-Max 50, nicht vom User erhoehbar
  "daily_cap"                integer NOT NULL DEFAULT 50,
  -- Stage 0 => 20/Tag, 1 => 35/Tag, >=2 => min(daily_cap, 50)
  "warmup_stage"             integer NOT NULL DEFAULT 0,
  "sent_today"               integer NOT NULL DEFAULT 0,
  "sent_today_date"          date,
  "next_eligible_at"         timestamptz,
  "timezone"                 text NOT NULL DEFAULT 'Europe/Berlin',
  "send_window"              jsonb NOT NULL DEFAULT '{"days":[1,2,3,4,5],"startHour":8,"endHour":17}'::jsonb,
  -- m365: { deltaLink }; smtp: { uidValidity, lastSeenUid }
  "sync_state"               jsonb,
  "last_error"               text,
  "last_sync_at"             timestamptz,
  "created_at"               timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"               timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "mailbox_connections_user_email_uq" UNIQUE ("user_id", "email_address")
);
CREATE INDEX IF NOT EXISTS "mailbox_connections_user_idx"
  ON "mailbox_connections" ("user_id");

-- ── 2. email_templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"            text NOT NULL,
  "subject"         text NOT NULL,
  -- TipTap-Dokument
  "body_json"       jsonb,
  "body_html"       text NOT NULL,
  "cta_label"       text NOT NULL DEFAULT 'Video ansehen',
  "cta_url"         text NOT NULL DEFAULT '@system:pageUrl',
  "signature_html"  text,
  -- Pflichtfeld — ohne Impressum kein Speichern-als-fertig
  "impressum_html"  text NOT NULL,
  "deleted_at"      timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "email_templates_user_idx"
  ON "email_templates" ("user_id")
  WHERE "deleted_at" IS NULL;

-- ── 3. email_blasts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_blasts" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "campaign_id"            uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "run_id"                 uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "mailbox_connection_id"  uuid NOT NULL REFERENCES "mailbox_connections"("id"),
  "template_id"            uuid NOT NULL REFERENCES "email_templates"("id"),
  -- 'draft' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  "status"                 text NOT NULL DEFAULT 'draft',
  -- beim Start eingefrorene Vorlage {subject, bodyHtml, ctaLabel, ctaUrl, signatureHtml, impressumHtml, gifConfig}
  "content_snapshot"       jsonb NOT NULL,
  "total_count"            integer NOT NULL DEFAULT 0,
  "sent_count"             integer DEFAULT 0,
  "failed_count"           integer DEFAULT 0,
  "skipped_count"          integer DEFAULT 0,
  "bounced_count"          integer DEFAULT 0,
  "replied_count"          integer DEFAULT 0,
  -- 1 Credit = 10 Mails, aufgerundet, Charge beim Start
  "credits_charged"        integer NOT NULL DEFAULT 0,
  -- protokollierter Selbstbestaetigungs-Screen {confirmedAt, textVersion, userId}
  "confirmation_log"       jsonb,
  "started_at"             timestamptz,
  "completed_at"           timestamptz,
  "created_at"             timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"             timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "email_blasts_user_idx"
  ON "email_blasts" ("user_id");
CREATE INDEX IF NOT EXISTS "email_blasts_campaign_idx"
  ON "email_blasts" ("campaign_id");
CREATE INDEX IF NOT EXISTS "email_blasts_mailbox_status_idx"
  ON "email_blasts" ("mailbox_connection_id", "status");

-- ── 4. email_messages ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_messages" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "blast_id"               uuid NOT NULL REFERENCES "email_blasts"("id") ON DELETE CASCADE,
  "lead_id"                uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "mailbox_connection_id"  uuid NOT NULL REFERENCES "mailbox_connections"("id"),
  "to_email"               text NOT NULL,
  -- 'scheduled' | 'sent' | 'failed' | 'skipped' | 'bounced'
  "status"                 text NOT NULL DEFAULT 'scheduled',
  "claimed_at"             timestamptz,
  "sent_at"                timestamptz,
  -- EIGENE Message-ID (<uuid@videocomet.de>), VOR Versand generiert (NDR-Korrelation)
  "internet_message_id"    text,
  "graph_message_id"       text,
  "conversation_id"        text,
  -- random 32 hex
  "unsubscribe_token"      text NOT NULL,
  "replied_at"             timestamptz,
  "unsubscribed_at"        timestamptz,
  "skip_reason"            text,
  "error"                  text,
  "created_at"             timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "email_messages_unsubscribe_token_unique" UNIQUE ("unsubscribe_token"),
  CONSTRAINT "email_messages_blast_lead_uq" UNIQUE ("blast_id", "lead_id")
);
CREATE INDEX IF NOT EXISTS "email_messages_blast_status_idx"
  ON "email_messages" ("blast_id", "status");
CREATE INDEX IF NOT EXISTS "email_messages_lead_idx"
  ON "email_messages" ("lead_id");
CREATE INDEX IF NOT EXISTS "email_messages_internet_message_id_idx"
  ON "email_messages" ("internet_message_id");

-- ── 5. email_suppressions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- lowercase persistiert
  "email"              text NOT NULL,
  -- 'unsubscribe' | 'bounce' | 'manual'
  "reason"             text NOT NULL,
  "source_message_id"  uuid,
  "created_at"         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "email_suppressions_user_email_uq" UNIQUE ("user_id", "email")
);

-- ── 6. Erweiterungen bestehender Tabellen ──────────────────────────────
-- { startSec, durationSec } (durationSec 2-4, default 3)
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "email_gif_config" jsonb;

-- Hash = sha1(video_content_hash + JSON(gifConfig))
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "email_gif_url" text,
  ADD COLUMN IF NOT EXISTS "email_gif_hash" text;

COMMIT;
