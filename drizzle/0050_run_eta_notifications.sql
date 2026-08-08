-- W3 Skalierungs-Paket: ETA + Abschluss-Mail
-- 1) Opt-out fuer Run-Abschluss-/Fehler-Mails (Default AN).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_run_emails boolean NOT NULL DEFAULT true;

-- 2) Dedup-Guard: genau EINE Mail pro Run (atomarer Claim via
--    UPDATE ... WHERE completion_email_sent_at IS NULL RETURNING).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS completion_email_sent_at timestamptz;

-- 3) Partial-Index fuer die ETA-Median-Query: pro Lead gibt es genau ein
--    "completed in Xs"-Event (stage='run', lead_id gesetzt, duration_ms
--    gesetzt). Der Index haelt die Median-Abfrage auch bei Millionen
--    pipeline_events-Rows billig.
CREATE INDEX IF NOT EXISTS pipeline_events_lead_duration_idx
  ON pipeline_events (run_id, ts DESC)
  WHERE stage = 'run' AND lead_id IS NOT NULL AND duration_ms IS NOT NULL;

-- 4) Gleicher Filter, aber global nach Zeit: fuer den Fallback-Median ueber
--    alle Runs der letzten 7 Tage (wenn der laufende Run noch keine eigenen
--    fertigen Leads hat).
CREATE INDEX IF NOT EXISTS pipeline_events_lead_duration_ts_idx
  ON pipeline_events (ts DESC)
  WHERE stage = 'run' AND lead_id IS NOT NULL AND duration_ms IS NOT NULL;
