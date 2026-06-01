-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0005: Custom-Landingpages (Kunden-eigene HTML/CSS/JS Templates)
--
-- Bringt:
--   - custom_lp_templates      : ein Eintrag pro Kunden-Template (Name +
--                                aktive Version + optionales Thumbnail)
--   - custom_lp_versions       : eine Zeile pro hochgeladenem ZIP-Stand
--                                (immutable). Versions sind pro Template
--                                eindeutig (1, 2, 3, …).
--   - campaigns.custom_lp_template_id : optional, FK auf Template (SET NULL)
--   - runs.custom_lp_version_id       : optional, FK auf Version (SET NULL).
--     Beim Run-Start wird der Active-State der Vorlage einmalig "gepinnt",
--     spätere Vorlagen-Updates ändern bereits gestartete Runs nicht.
--
-- Reversibilität: alle ADD COLUMN sind nullable. Vorhandene Daten bleiben
-- unangetastet (additive Migration, kein DROP).
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "custom_lp_templates" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"            uuid NOT NULL,
  "name"               text NOT NULL,
  "description"        text,
  "active_version_id"  uuid,
  "thumbnail_url"      text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "custom_lp_templates" ADD CONSTRAINT "custom_lp_templates_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "custom_lp_templates_user_idx" ON "custom_lp_templates" ("user_id");
--> statement-breakpoint

CREATE TABLE "custom_lp_versions" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id"    uuid NOT NULL,
  "version"        integer NOT NULL,
  "storage_path"   text NOT NULL,
  "entry_html"     text NOT NULL DEFAULT 'index.html',
  "manifest"       jsonb,
  "file_manifest"  jsonb NOT NULL,
  "annotations"    jsonb,
  "bytes_total"    integer NOT NULL,
  "uploaded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "custom_lp_versions_tpl_ver_uq" UNIQUE ("template_id", "version")
);
--> statement-breakpoint
ALTER TABLE "custom_lp_versions" ADD CONSTRAINT "custom_lp_versions_template_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "public"."custom_lp_templates"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "custom_lp_versions_template_idx" ON "custom_lp_versions" ("template_id");
--> statement-breakpoint

-- Vorwärts-FK auf custom_lp_versions kann erst NACH dessen Anlage gesetzt
-- werden. Wir verwenden SET NULL, damit das Löschen einer Version (oder des
-- Templates inkl. Versions) nicht das Template selbst zerstört.
ALTER TABLE "custom_lp_templates" ADD CONSTRAINT "custom_lp_templates_active_version_id_fk"
  FOREIGN KEY ("active_version_id") REFERENCES "public"."custom_lp_versions"("id") ON DELETE set null;
--> statement-breakpoint

-- campaigns.custom_lp_template_id (NULL = Block-basierte Default-Landingpage)
ALTER TABLE "campaigns" ADD COLUMN "custom_lp_template_id" uuid;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_custom_lp_template_id_fk"
  FOREIGN KEY ("custom_lp_template_id") REFERENCES "public"."custom_lp_templates"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "campaigns_custom_lp_template_idx" ON "campaigns" ("custom_lp_template_id");
--> statement-breakpoint

-- runs.custom_lp_version_id (immutable Pin: Run hängt an EINER konkreten
-- Version, damit ein späteres Template-Update den Run nicht "umzieht").
ALTER TABLE "runs" ADD COLUMN "custom_lp_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_custom_lp_version_id_fk"
  FOREIGN KEY ("custom_lp_version_id") REFERENCES "public"."custom_lp_versions"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "runs_custom_lp_version_idx" ON "runs" ("custom_lp_version_id");
