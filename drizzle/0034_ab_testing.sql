-- A/B-Test fuer Brief-Vorlagen (Kampagne kann zwei Google-Docs-Briefe haben).
-- pdf_google_docs_url bleibt Variante A; Variante B kommt in eine neue Spalte.
-- Die Verteilungsregel wird pro Runde konfiguriert und beim Start als
-- Snapshot in runs.ab_config eingefroren; jeder Lead bekommt ab_variant.
ALTER TABLE campaigns
  ADD COLUMN ab_testing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN pdf_google_docs_url_b text;

ALTER TABLE runs
  ADD COLUMN ab_config jsonb;

ALTER TABLE leads
  ADD COLUMN ab_variant text CHECK (ab_variant IN ('A', 'B'));
