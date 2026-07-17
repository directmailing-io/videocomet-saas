-- Clean-Render-Telemetrie: ein Row pro gerenderter Kunden-Domain.
-- Upsert nach jedem Website-Capture (Video-Scroll, Screenshot, Fallback).
CREATE TABLE IF NOT EXISTS domain_render_profiles (
  hostname text PRIMARY KEY,
  platform text NOT NULL DEFAULT 'unknown',
  cmp text NOT NULL DEFAULT 'unknown',
  resolved_by text NOT NULL DEFAULT 'none',
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  last_problem text,
  last_capture_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
