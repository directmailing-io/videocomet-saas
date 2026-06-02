-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0006: Lead-Quality-Check / Preflight (Phase 1)
--
-- Führt die zweistufige Pipeline ein: bevor die teure Vollproduktion läuft,
-- wird pro Lead eine billige Validierung + Vorab-Screenshot erzeugt. Der
-- Operator approved/rejected im Grid; nur approved-Leads gehen in Phase 2.
--
-- Bringt:
--   - leads.preflight_* + duplicate/approval/removal-Spalten
--   - runs.preflight_* + Aggregat-Counter
--   - runs.status um preflighting/awaiting_approval/approved erweitert
--   - partielle Indexes für die UI-Filter (problematische Leads zuerst)
--
-- Reversibilität: alle ADD COLUMN sind nullable / haben Defaults. ENUM-Werte
-- können in Postgres nicht entfernt werden (per Design); die Migration ist
-- daher additiv und nicht rollbar — bewusst, weil ein Rollback eh erst nach
-- erfolgreichem Produktiv-Lauf der Pipeline relevant würde.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) run_status-ENUM um neue Phasen erweitern.
--    'cancelled' existiert bereits aus Migration 0000.
ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'preflighting';
--> statement-breakpoint
ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'awaiting_approval';
--> statement-breakpoint
ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'approved';
--> statement-breakpoint

-- 2) leads-Tabelle: Preflight-Status + Screenshot-Metadaten + Soft-Delete.
ALTER TABLE "leads" ADD COLUMN "preflight_status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_screenshot_url" text;
--> statement-breakpoint
-- Bunny-Object-Key separat zum URL gespeichert, damit das spätere Bulk-Delete
-- den Pfad nicht aus der CDN-URL zurückrechnen muss (CDN-Hostname kann sich
-- ändern, Object-Key bleibt stabil).
ALTER TABLE "leads" ADD COLUMN "preflight_screenshot_key" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_final_url" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_http_status" smallint;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_error_message" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_attempts" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preflight_completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "duplicate_of_lead_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_duplicate_of_lead_id_fk"
  FOREIGN KEY ("duplicate_of_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "removed_at" timestamp with time zone;
--> statement-breakpoint
-- user_rejected | auto_failed | duplicate
ALTER TABLE "leads" ADD COLUMN "removed_reason" text;
--> statement-breakpoint

-- Partielle Indexes für die häufigsten UI-Queries:
--   (1) Live-Filter "problematische Leads zuerst" pro Run
--   (2) Approved-Counter (für die Confirm-Modal-Anzeige + Worker-Auswahl)
CREATE INDEX "leads_preflight_status_idx" ON "leads" ("run_id", "preflight_status")
  WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "leads_approved_idx" ON "leads" ("run_id")
  WHERE "approved_at" IS NOT NULL AND "removed_at" IS NULL;
--> statement-breakpoint

-- 3) runs-Tabelle: Phase-1-Metadaten + Aggregat-Counter.
ALTER TABLE "runs" ADD COLUMN "preflight_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "preflight_completed_at" timestamp with time zone;
--> statement-breakpoint
-- Optional: wenn gesetzt, kann ein späterer Cron alle ok-Leads automatisch
-- approven nach Ablauf dieses Zeitpunkts (Default: NULL = manuelle Freigabe).
ALTER TABLE "runs" ADD COLUMN "auto_approve_after" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "approved_lead_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "rejected_lead_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "preflight_failed_count" integer NOT NULL DEFAULT 0;
