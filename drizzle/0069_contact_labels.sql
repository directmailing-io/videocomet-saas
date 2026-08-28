-- Labels für Kontakte (Kontakte & Listen).
-- Frei benennbare Markierungen (z. B. "Versand 14.08.2026", "Rückläufer"),
-- vergeben manuell per Bulk-Aktion oder automatisch beim Runden-Start /
-- Versandzentrale-Markierung.

CREATE TABLE IF NOT EXISTS "contact_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#AA8CF5',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Ein Label-Name pro User nur einmal (case-insensitiv).
CREATE UNIQUE INDEX IF NOT EXISTS "contact_labels_user_name_uq"
  ON "contact_labels" ("user_id", LOWER("name"));

CREATE TABLE IF NOT EXISTS "contact_label_assignments" (
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "label_id" uuid NOT NULL REFERENCES "contact_labels"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("contact_id", "label_id")
);

CREATE INDEX IF NOT EXISTS "contact_label_assignments_label_idx"
  ON "contact_label_assignments" ("label_id");
