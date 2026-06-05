-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0011: media_items.width / media_items.height
--
-- Hintergrund: bisher gingen UI + Render-Worker implizit von 16:9 (1280×720)
-- als Source-Format aus. Wenn der User ein Hochformat-Video (z. B. 9:16
-- Selfie) hochlädt, pillarboxen wir es im finalen MP4 — und in der Wizard-
-- Preview wird es per `aspect-video` gestreckt/abgeschnitten.
--
-- Mit `width` + `height` (gemessen via ffprobe beim Upload) kann der Renderer
-- die richtige Output-Auflösung wählen (1920×1080 für Landscape, 1080×1920
-- für Portrait) und die UI das Aspect honorieren.
--
-- Beide Spalten sind NULLABLE. Backfill ist nicht nötig — Altbestand bleibt
-- auf NULL und der Code fällt dort transparent auf das alte Landscape-
-- Verhalten zurück. Neue Uploads bekommen die Werte automatisch befüllt.
--
-- Reversibel: zwei ALTER TABLE … DROP COLUMN würden reichen.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "media_items"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer;
