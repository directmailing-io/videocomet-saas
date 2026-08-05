-- greeting_end_ms: Ende der Anrede („Hi!") = Start der bewussten Pause.
-- Getrennt von anchor_end_ms (= Ende des GANZEN ersten Satzes), damit die
-- Intro-Engine je nach Template-Länge den passenden Cut-Punkt wählen kann:
--   - Kurzes Template („Hi {vorname}") → greeting_end_ms
--   - Volles Template („Hallo {vorname}! Schön, dass ...") → anchor_end_ms
-- Bestehende Kalibrierungen bleiben NULL; die Engine fällt für NULL auf
-- anchor_end_ms zurück (kein Regression-Risiko für alte Runs).
ALTER TABLE intro_calibrations
  ADD COLUMN greeting_end_ms INTEGER;
