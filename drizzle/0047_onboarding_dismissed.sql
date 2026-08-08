-- Onboarding-Checkliste: "Nicht mehr anzeigen" dauerhaft pro User merken.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_dismissed_at" timestamptz;
