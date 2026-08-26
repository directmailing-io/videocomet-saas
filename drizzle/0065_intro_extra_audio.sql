-- KI-Stimme 2026-08-26: Zusatz-Audio für kurze Kampagnen-Videos.
-- Liefert das Video weniger als ~90s Ton, nimmt der User im Wizard eine
-- freie Sprachprobe auf. Der Kalibrierungs-Processor kombiniert Video-Ton
-- + Zusatz-Audio zu EINEM Fish-Trainings-Sample (gleiches Mikro/Raum).
ALTER TABLE intro_calibrations ADD COLUMN IF NOT EXISTS extra_audio_url text;
