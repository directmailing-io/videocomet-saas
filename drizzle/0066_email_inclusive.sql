-- E-Mail-Versand inklusive (statt 10 Mails = 1 Credit) + Schutz-Limits.
--
--  * email_blasts.mailbox_connection_ids: Postfach-Rotation — alle
--    Postfaecher des Blasts. mailbox_connection_id bleibt als primaeres
--    Postfach erhalten (NOT NULL, Alt-Daten + FK).
--  * email_blasts.pause_reason: Klartext-Grund bei automatischer Pause
--    (Bounce-Schutz). NULL = manuell pausiert / nicht pausiert.
--  * email_messages.earliest_send_at: Schutz-Limit max. 4 Mails pro
--    Empfaenger-Adresse in 30 Tagen — Message wartet bis zu diesem
--    Zeitpunkt, statt uebersprungen zu werden.
--  * Index fuer die 30-Tage-Fenster-Abfrage (gesendete Mails pro Adresse).

ALTER TABLE email_blasts ADD COLUMN IF NOT EXISTS mailbox_connection_ids jsonb;
ALTER TABLE email_blasts ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS earliest_send_at timestamptz;

CREATE INDEX IF NOT EXISTS email_messages_to_email_sent_idx
  ON email_messages (to_email, sent_at)
  WHERE status = 'sent';
