-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0010: Webcam-Share-Link-Slug pro User eindeutig
--
-- Hintergrund: Bisher war `webcam_share_links_slug_uq` ein GLOBALES UNIQUE
-- über `slug` (über alle User hinweg). Das ist unnötig restriktiv und
-- mengentechnisch nicht skalierbar (jeder neue User „verbraucht" Slugs
-- für alle anderen). Da Slugs crypto-random 14 Zeichen aus einem
-- 57-Zeichen-Alphabet sind (≈ 57^14 ≈ 1.0e24 Möglichkeiten), ist eine
-- Kollision zwischen zwei verschiedenen Usern faktisch ausgeschlossen.
-- Wir schalten daher auf den fachlich korrekten Scope `(user_id, slug)`.
--
-- Invarianten nach Migration:
--   - Ein einzelner User kann denselben Slug niemals zweimal nutzen.
--   - Zwei verschiedene User KÖNNTEN theoretisch denselben Slug haben —
--     die Public-Lookups (`getShareLinkBySlugPublic` /
--     `getShareLinkBySlugInternal`) liefern in dem Fall einen der beiden
--     Einträge (`LIMIT 1`). Wahrscheinlichkeit: praktisch null.
--   - Kein Backfill / kein Datenrisiko: jeder Bestands-Eintrag hat einen
--     eindeutigen Slug und damit erst recht eindeutige `(user_id, slug)`.
--
-- Reversibel: einzelne Constraint-/Index-Operation, keine Datenänderung.
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Alten globalen UNIQUE entfernen.
--    Drizzle hat den Constraint als regulären UNIQUE-Index angelegt
--    (`CREATE UNIQUE INDEX … webcam_share_links_slug_uq`). Auf Postgres
--    reicht ein DROP INDEX IF EXISTS — Drop ist idempotent.
DROP INDEX IF EXISTS "webcam_share_links_slug_uq";
--> statement-breakpoint

-- 2. Neuen scoped UNIQUE pro `(user_id, slug)` anlegen.
--    Reihenfolge `user_id, slug` ist konsistent mit
--    `webcam_share_links_user_numeric_uq` (Migration 0009) und passt
--    zum häufigsten Query-Muster (Tenant-aware Lookup).
CREATE UNIQUE INDEX "webcam_share_links_user_slug_uq"
  ON "webcam_share_links" ("user_id", "slug");
