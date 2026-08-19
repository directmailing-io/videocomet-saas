-- Retro-Fix Run-Zähler: `runs.completed_leads` und `runs.failed_leads`
-- wurden bis Fix in `finalizeRunIfAllLeadsDone` (2026-08-19) nie
-- inkrementiert; in der UI sahen fertige Runs deshalb wie „0 von X"
-- aus. Dieses Statement rechnet die Zähler für alle bestehenden Runs
-- aus den tatsächlichen Lead-Status ab.
UPDATE runs r
SET
  completed_leads = COALESCE((
    SELECT COUNT(*)::int
    FROM leads l
    WHERE l.run_id = r.id
      AND l.status = 'completed'
      AND l.removed_at IS NULL
  ), 0),
  failed_leads = COALESCE((
    SELECT COUNT(*)::int
    FROM leads l
    WHERE l.run_id = r.id
      AND l.status = 'failed'
      AND l.removed_at IS NULL
  ), 0)
WHERE r.completed_leads = 0
  AND r.failed_leads = 0
  AND EXISTS (
    SELECT 1 FROM leads l2
    WHERE l2.run_id = r.id
      AND l2.status IN ('completed', 'failed')
      AND l2.removed_at IS NULL
  );
