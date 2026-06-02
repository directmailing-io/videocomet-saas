-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0007: Preflight-Purge-Audit-Spalte
--
-- Ergänzung zu 0006: eine einzige zusätzliche Spalte auf `runs`, um den
-- 7-Tage-Cleanup-Cron für Preflight-Screenshots idempotent zu machen.
--
-- Ohne diese Spalte müsste der Cron jeden Lauf alle eligible Runs neu
-- berechnen UND für jeden Run einen Bunny-LIST-Walk machen, nur um
-- festzustellen dass schon nichts mehr da ist. Mit `preflight_purged_at`
-- wissen wir auf einen Blick "schon erledigt" und überspringen den Run.
--
-- Wird vom internal-Endpoint `/api/internal/preflight-cleanup` und vom
-- Shell-Cron `scripts/preflight-cleanup-cron.sh` gelesen/geschrieben.
--
-- Reversibel: ADD COLUMN nullable, kein Default-Constraint nötig.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "preflight_purged_at" timestamp with time zone;
