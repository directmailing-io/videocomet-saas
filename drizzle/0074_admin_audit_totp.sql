-- Security-Härtung 2026-09-02:
--  1) Admin-Audit-Log: jede mutierende Admin-Aktion wird protokolliert.
--  2) TOTP-Zwei-Faktor für Admin-Konten (Secret AES-GCM-verschlüsselt).

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "admin_email" text,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "details" jsonb,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_idx" ON "admin_audit_log" ("created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_log_admin_idx" ON "admin_audit_log" ("admin_user_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret_enc" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;
