BEGIN;

-- 1. leads.removed_detail jsonb für strukturierte Begründungen
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "removed_detail" jsonb;

-- 2. runs.dedupe_config jsonb für persistierte Regel-Konfig
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "dedupe_config" jsonb;

-- 3. removed_reason-Wertebereich erweitern (idempotent via pg_constraint)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_removed_reason_check') THEN
    ALTER TABLE "leads" DROP CONSTRAINT "leads_removed_reason_check";
  END IF;
  ALTER TABLE "leads" ADD CONSTRAINT "leads_removed_reason_check" CHECK (
    removed_reason IS NULL OR removed_reason IN (
      'user_rejected', 'auto_failed', 'duplicate',
      'pipeline_failed', 'incomplete_data'
    )
  );
END $$;

-- 4. Performance-Index für den Lead-Export
CREATE INDEX IF NOT EXISTS "leads_run_removed_idx"
  ON "leads"("run_id") WHERE "removed_at" IS NOT NULL;

COMMIT;
