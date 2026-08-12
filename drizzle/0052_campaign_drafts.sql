-- Kampagnen-Entwuerfe: Kampagnen entstehen jetzt bereits beim ersten
-- Wizard-Fortschritt als status='draft' und werden erst beim finalen
-- "Kampagne speichern" aktiviert. wizard_state haelt den kompletten
-- Wizard-Snapshot (State + Schritt) fuer verlustfreies Fortsetzen —
-- inkl. Feldern, die keine eigene campaigns-Spalte haben (z. B.
-- KI-Begruessungs-Prefix/Namens-Muster). Wird bei Aktivierung genullt.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS wizard_state jsonb;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active'));
