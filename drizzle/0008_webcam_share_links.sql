-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0008: Webcam-Share-Links
--
-- Erlaubt einem eingeloggten User, einen öffentlichen Share-Link zu
-- erzeugen. Ein nicht-eingeloggter Gast öffnet diesen Link und nimmt im
-- Browser eine Webcam-Aufnahme auf, die nach Absenden automatisch in die
-- Mediathek des LINK-OWNERS hochgeladen wird.
--
-- Wichtige Invarianten:
--   - `slug` ist URL-safe, 12–16 Zeichen, global eindeutig.
--   - Pro Link genau EINE erfolgreiche Aufnahme: `used_at` + `media_item_id`
--     werden gemeinsam gesetzt; ein zweiter Submit-Versuch liefert 409.
--   - `revoked_at` ist eine manuelle Sperrung durch den Owner.
--   - Löscht der Owner ein resultierendes Media-Item, bleibt der Link-
--     Eintrag bestehen (used_at gesetzt) und media_item_id wird NULL.
--
-- Reversibel: einzelne Tabelle + Indexe, keine Änderung an Bestandsschema.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "webcam_share_links" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"           uuid NOT NULL,
  "slug"              text NOT NULL,
  "title"             text,
  "max_duration_sec"  integer NOT NULL DEFAULT 120,
  "expires_at"        timestamp with time zone,
  "used_at"           timestamp with time zone,
  "media_item_id"     uuid,
  "revoked_at"        timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "webcam_share_links" ADD CONSTRAINT "webcam_share_links_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "webcam_share_links" ADD CONSTRAINT "webcam_share_links_media_item_id_fk"
  FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX "webcam_share_links_slug_uq" ON "webcam_share_links" ("slug");
--> statement-breakpoint
CREATE INDEX "webcam_share_links_user_idx" ON "webcam_share_links" ("user_id");
