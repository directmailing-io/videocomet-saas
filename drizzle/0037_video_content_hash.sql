-- Content-Fingerprint für den Video-Resume-Pfad (Review-Fund 5).
-- Wird zusammen mit bunny_video_id persistiert; ein Retry darf das
-- existierende Bunny-Video nur weiterverwenden, wenn der Hash der
-- render-relevanten Inputs (Webcam, Website, Segments, Lead-Daten,
-- Mapping, PiP) unverändert ist. Sonst würde nach einer zwischenzeitlichen
-- Kampagnen-Änderung ein veraltetes Video ausgespielt.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS video_content_hash text;
