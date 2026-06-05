-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0016: media_items.available_resolutions
--
-- Persistiert die von Bunny Stream real gerenderten Resolutions-Labels
-- (`["240p", "480p", "1080p", ...]`) pro Media-Item, damit der MP4-Fallback-
-- Helper `pickBunnyMp4Fallback()` ohne extra Round-Trip zur Bunny-API die
-- höchste tatsächlich verfügbare Auflösung wählen kann.
--
-- Hintergrund: Bunny rendert pro Quellvideo nur Resolutionen, die Sinn
-- ergeben. Ein 404×720-Portrait-Video bekommt z.B. nur 240p/360p/480p —
-- ein hardcoded `play_720p.mp4` liefert dann 404. Mit der Spalte können
-- Bestand-Lookups die korrekte Auflösung wählen.
--
-- NULL = "unbekannt / Altbestand". Der Helper fällt dann auf den safe-
-- default `play_480p.mp4` zurück (existiert für JEDES Bunny-Stream-Video).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "media_items"
  ADD COLUMN IF NOT EXISTS "available_resolutions" text[];
