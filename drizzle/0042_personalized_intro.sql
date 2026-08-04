-- Migration 0042 — Personalisierte Video-Begrüßung ("Hi Jürgen"-Intro)
--
-- Pro User ein Voice-Clone (Fish Audio TTS), pro Webcam-Video eine
-- Kalibrierung (erster Satz, Schnittpunkte, Loudness-/Spektral-Referenz,
-- Raumton). Die Render-Pipeline (Phase 2) ersetzt damit den ersten Satz
-- des Webcam-Videos durch eine KI-personalisierte Begrüßung inkl.
-- Lip-Sync (sync.so), schnittfrei zusammengesetzt via ffmpeg.

BEGIN;

CREATE TABLE IF NOT EXISTS "voice_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  -- pending_sample | processing | ready | failed
  "status" text NOT NULL DEFAULT 'pending_sample',
  "fish_model_id" text,
  "sample_url" text,
  "sample_duration_sec" integer,
  -- Einwilligungen (DSGVO): Stimm-Klonen + KI-Generierung, Textversion + IP.
  "consent_voice_at" timestamptz,
  "consent_ai_at" timestamptz,
  "consent_text_version" text,
  "consent_ip" text,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "intro_calibrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "media_item_id" uuid NOT NULL UNIQUE REFERENCES "media_items"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- pending | running | ready | failed
  "status" text NOT NULL DEFAULT 'pending',
  "transcript_sentence" text,
  "tts_template" text,
  -- Schnittpunkte im Original (Millisekunden)
  "speech_start_ms" integer,
  "anchor_end_ms" integer,
  "resume_ms" integer,
  -- Loudness-/Spektral-Referenz für das TTS-Matching
  "lufs_ref" real,
  "spectral_ref" jsonb,
  "roomtone_url" text,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "intro_calib_user_idx" ON "intro_calibrations" ("user_id");

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS intro_enabled boolean NOT NULL DEFAULT false;

-- NULL | generated | fallback_name | fallback_error | disabled
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intro_status text;

-- Array von {leadId, videoUrl} — Vorschau-Videos vor Freigabe der Runde.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS intro_preview jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS intro_preview_approved_at timestamptz;

COMMIT;
