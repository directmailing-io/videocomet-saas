-- W4 Skalierungs-Paket: Anrede-Dedup.
-- Identische Begruessungen (gleicher TTS-Text + Stimme + Webcam-Video +
-- Kalibrierungs-Stand) werden nur einmal generiert; weitere Leads verweisen
-- auf dasselbe fertige Video. Claim-Protokoll siehe src/worker/lib/intro-dedup.ts.
CREATE TABLE IF NOT EXISTS intro_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS intro_cache_user_key_uq
  ON intro_cache (user_id, cache_key);
