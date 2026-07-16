-- Standard-Verteilungsregel des Brief-A/B-Tests auf Kampagnen-Ebene.
-- Wird beim Einrichten des Tests festgelegt (Wizard/Einstellungen) und
-- befüllt den Runden-Wizard vor; pro Runde weiterhin überschreibbar
-- (Snapshot bleibt runs.ab_config).
ALTER TABLE campaigns
  ADD COLUMN ab_split_mode text NOT NULL DEFAULT 'random',
  ADD COLUMN ab_split_weight_a integer NOT NULL DEFAULT 50;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_ab_split_mode_check
    CHECK (ab_split_mode IN ('random', 'sequential')),
  ADD CONSTRAINT campaigns_ab_split_weight_a_check
    CHECK (ab_split_weight_a BETWEEN 10 AND 90);
