-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0004: Custom-Domains
--
-- Bringt:
--   - user_domains      : ein Eintrag pro Kunden-Domain (max 3/User soft cap im API)
--   - domain_check_log  : Verifikations- und Cert-Health-Historie
--   - leads.domain_id   : optional, NULL = Default app.videocomet.de
--   - campaigns.domain_id + slug_template
--   - Partielle Unique-Indexes auf leads.slug:
--       1) leads_default_slug_uq : WHERE domain_id IS NULL  (Backward-Compat)
--       2) leads_custom_slug_uq  : WHERE domain_id IS NOT NULL (per-Domain)
--
-- Reversibilitaet: alle ADD COLUMN sind nullable / haben Defaults. Drop des
-- vorherigen globalen UNIQUE CONSTRAINT (leads_slug_uq) wird durch die zwei
-- partiellen Indexes funktional ersetzt.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "user_domains" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"         uuid NOT NULL,
  "hostname"        text NOT NULL,
  "kind"            text NOT NULL,                  -- 'subdomain' | 'apex'
  "status"          text NOT NULL DEFAULT 'pending',-- pending|verifying|issuing_cert|active|failed
  "verify_token"    text NOT NULL,
  "verified_at"     timestamp with time zone,
  "ssl_issued_at"   timestamp with time zone,
  "ssl_expires_at"  timestamp with time zone,
  "last_checked_at" timestamp with time zone,
  "last_error"      text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_domains" ADD CONSTRAINT "user_domains_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
-- Hostnames sind case-insensitive eindeutig ueber alle User (DNS ist case-insensitive).
CREATE UNIQUE INDEX "user_domains_hostname_uq" ON "user_domains" (LOWER("hostname"));
--> statement-breakpoint
CREATE INDEX "user_domains_user_idx"   ON "user_domains" ("user_id");
--> statement-breakpoint
CREATE INDEX "user_domains_status_idx" ON "user_domains" ("status");
--> statement-breakpoint

CREATE TABLE "domain_check_log" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "domain_id" uuid NOT NULL,
  "ts"        timestamp with time zone NOT NULL DEFAULT now(),
  "kind"      text NOT NULL,   -- 'dns' | 'txt' | 'cert' | 'health'
  "ok"        boolean NOT NULL,
  "message"   text
);
--> statement-breakpoint
ALTER TABLE "domain_check_log" ADD CONSTRAINT "domain_check_log_domain_id_fk"
  FOREIGN KEY ("domain_id") REFERENCES "public"."user_domains"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "domain_check_log_domain_idx" ON "domain_check_log" ("domain_id", "ts" DESC);
--> statement-breakpoint

-- leads.domain_id (NULL = Default app.videocomet.de)
ALTER TABLE "leads" ADD COLUMN "domain_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_domain_id_fk"
  FOREIGN KEY ("domain_id") REFERENCES "public"."user_domains"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "leads_domain_idx" ON "leads" ("domain_id");
--> statement-breakpoint

-- Globalen Slug-UNIQUE durch zwei partielle UNIQUE-Indexes ersetzen.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_slug_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_default_slug_uq" ON "leads" ("slug")
  WHERE "domain_id" IS NULL AND "slug" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_custom_slug_uq" ON "leads" ("domain_id", "slug")
  WHERE "domain_id" IS NOT NULL AND "slug" IS NOT NULL;
--> statement-breakpoint

-- campaigns.domain_id + slug_template
ALTER TABLE "campaigns" ADD COLUMN "domain_id"     uuid;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_domain_id_fk"
  FOREIGN KEY ("domain_id") REFERENCES "public"."user_domains"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "slug_template" text;
--> statement-breakpoint
CREATE INDEX "campaigns_domain_idx" ON "campaigns" ("domain_id");
