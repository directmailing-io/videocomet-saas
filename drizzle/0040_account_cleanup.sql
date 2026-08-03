-- Migration 0040 — Abo-Ende-Cleanup (30-Tage-Löschung)
--
-- Gruender-Entscheidung 2026-08-03: Nach Abo-Ende (canceled/unpaid und
-- Periodenende erreicht) bekommen User 30 Tage Frist, dann werden Seiten
-- und Videos KOMPLETT geloescht. Drei Mails: Ankuendigung (Tag 0),
-- Erinnerung (7 Tage vor Loeschung), Bestaetigung (nach Loeschung).
--
-- Eine Row pro User (PK user_id) = der AKTUELLE Cleanup-Zyklus. Reaktiviert
-- der User sein Abo, wird der Zyklus per canceled_at abgebrochen. Kuendigt
-- er spaeter erneut, wird die Row zurueckgesetzt (neuer Zyklus).
--
-- NICHT geloescht werden: User-Account, Credits (verfallen nie),
-- credit_transactions, Stripe-/Rechnungsdaten (Aufbewahrungspflicht).

BEGIN;

CREATE TABLE IF NOT EXISTS "account_cleanup_state" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "subscription_ended_at" timestamptz NOT NULL,
  "delete_after" timestamptz NOT NULL,
  "notice_sent_at" timestamptz,
  "reminder_sent_at" timestamptz,
  "deleted_at" timestamptz,
  "canceled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_cleanup_delete_after_idx"
  ON "account_cleanup_state" ("delete_after");

COMMIT;
