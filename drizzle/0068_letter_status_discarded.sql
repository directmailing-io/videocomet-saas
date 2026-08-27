-- Migration 0068: Neuer Brief-Status 'discarded' (Aussortiert).

ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_letter_status_check";

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_letter_status_check"
  CHECK ("letter_status" IN ('open', 'in_progress', 'sent', 'discarded'));
