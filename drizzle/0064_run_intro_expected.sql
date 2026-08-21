-- Reliability 2026-08-21: Snapshot beim Run-Start, ob die personalisierte
-- KI-Begrüßung für diese Runde verbindlich erwartet wird.
--   true  → jeder Lead MUSS introStatus 'generated' oder 'fallback_name'
--           haben, bevor er als erfolgreich gilt (Completeness-Gate).
--   false → Runde läuft bewusst ohne KI-Begrüßung (User-Entscheidung
--           oder Feature nicht bereit + explizit trotzdem gestartet).
--   NULL  → Alt-Runden vor dieser Migration (Gate prüft nicht).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS intro_expected boolean;
