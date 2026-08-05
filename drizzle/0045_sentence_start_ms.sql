-- sentence_start_ms: Start des ersten Satzes = Ende der bewussten Pause.
-- Für das kurze Anrede-Template braucht die Intro-Engine diesen Wert
-- getrennt vom resume_ms, um die Rest-Pause im Preview-Video auf ein
-- natürliches Maß zu kürzen (statt die ganze bewusste Pause stehen zu
-- lassen, die als 800-1500ms Loch wirken kann). Alte Kalibrierungen
-- bleiben NULL — die Engine hat einen konservativen Fallback.
ALTER TABLE intro_calibrations
  ADD COLUMN sentence_start_ms INTEGER;
