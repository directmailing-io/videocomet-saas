ALTER TABLE "intro_calibrations" ADD COLUMN "voice_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "intro_calibrations" ADD COLUMN "voice_fish_model_id" text;--> statement-breakpoint
ALTER TABLE "intro_calibrations" ADD COLUMN "voice_error" text;
