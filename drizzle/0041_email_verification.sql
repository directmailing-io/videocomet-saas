-- E-Mail-Verifizierung vor Buchung/Kauf.
-- Bestandskunden werden grandfathered (verifiziert = created_at), nur neue
-- Signups muessen den Bestaetigungslink klicken.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

UPDATE users SET email_verified_at = created_at;

CREATE TABLE email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verif_token_idx ON email_verifications(token_hash);
