-- Brand-Kit Account-Standard (Landingpage v3, Etappe 1): Der User kann
-- sein erkanntes bzw. selbst gewaehltes Brand-Kit (Logo, Farben, Schrift-
-- Paar, Rundung, Schatten) als Standard fuer neue Landingpages speichern.
-- So muss die Marke nur EINMAL eingerichtet werden — jeder neue Wizard-
-- Durchlauf bietet "Meinen gespeicherten Look verwenden" an und befuellt
-- neue Vorlagen direkt im Markenlook. Pro Vorlage bleibt das Kit weiterhin
-- in landing_page_templates.content.theme gespeichert (Agentur-User koennen
-- also mehrere Marken fahren); diese Spalte ist nur die Account-Vorbelegung.
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_kit_default jsonb;
