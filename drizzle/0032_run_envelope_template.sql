-- Runden koennen jetzt selbst waehlen ob und welche Umschlag-Vorlage
-- benutzt wird. Ueberschreibt/ersetzt campaigns.envelope_template_id
-- fuer diese Runde.
ALTER TABLE runs
  ADD COLUMN envelope_template_id uuid REFERENCES envelope_templates(id) ON DELETE SET NULL;
