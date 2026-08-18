-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0060: Guest-Session für Video-Feedback-Kommentare
--
-- Der Empfänger einer /review/<token>-Seite hat KEINE Lucia-Session, kann
-- aber trotzdem seine eigenen Kommentare bearbeiten/löschen. Wir speichern
-- deshalb eine zufällige `session_id` (uuid), die client-seitig im
-- LocalStorage pro Token gehalten wird. Beim Insert wird sie mitgeschrieben,
-- beim Edit/Delete muss die gleiche `session_id` mitgeschickt werden.
--
-- Sicherheits-Invarianten:
--   - `session_id` ist client-generierte UUID, kein Cookie — reicht als
--     Owner-Nachweis für den Kommentar (kein Kreditkarten-Level).
--   - Server validiert `WHERE id = ? AND session_id = ?` beim Edit/Delete.
--   - NULL für Alt-Bestand (Kommentare vor Migration) → nicht editierbar,
--     was ok ist (Owner kann sie im Editor immer löschen).
--
-- Reversibel: eine Spalte, kein Index-Zwang (Filter läuft eh mit id-Match
-- als Primary-Key-Lookup).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "video_feedback_comments"
  ADD COLUMN IF NOT EXISTS "session_id" text;

COMMIT;
