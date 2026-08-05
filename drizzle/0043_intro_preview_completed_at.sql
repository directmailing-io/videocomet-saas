-- Marker fürs Ende des Preview-Worker-Laufs. NULL = läuft noch (oder gar
-- nicht enqueued). Sobald der Worker fertig ist — egal ob 0, 1, 2 oder 3
-- Previews entstanden — setzt er den Timestamp. Damit kann die UI ein
-- „X von 3 fertig"-Progress zeigen, ohne den finalen Zustand von einem
-- Zwischenstand unterscheiden zu müssen (siehe intro-preview.ts).
ALTER TABLE runs
  ADD COLUMN intro_preview_completed_at TIMESTAMP WITH TIME ZONE;
