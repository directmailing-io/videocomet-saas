-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0023: Run-Delete Hard-Cascade (Slug-Freigabe)
--
-- Hintergrund:
--   Bisher hat `DELETE /api/runs/[id]` nur `runs.deleted_at` gesetzt
--   (Soft-Delete). Die Leads des Runs blieben physisch in der Tabelle —
--   und damit auch ihre `leads.slug`-Werte. Der campaign-scoped
--   Slug-Uniqueness-Check (siehe `findSlugInCampaign`) zählte diese
--   "toten" Slugs weiter mit. Folge: ein neuer Run derselben Kampagne hat
--   die Lead-Slugs als Kollision interpretiert und fortlaufend `-2`, `-3`
--   … angehängt. Kunde war zu Recht sauer.
--
--   Ab jetzt löscht die DELETE-Route hart (`db.delete(runs)`). Diese
--   Migration stellt sicher, dass die zugehörigen FK-Constraints in der
--   Produktions-DB tatsächlich `ON DELETE CASCADE` haben — auch in Envs,
--   die irgendwann mal manuell gepatched wurden oder auf älteren
--   Snapshot-Ständen sitzen.
--
--   Reine Defensive — die Drizzle-Schema-Definitionen tragen die Cascade-
--   Annotationen schon seit Migration 0000/0001/0003. Wir DROP'en und
--   RE-CREATE'n die Constraints idempotent (DROP IF EXISTS …, danach ADD),
--   sodass das Ergebnis identisch zur Schema-Definition ist — egal in
--   welchem Drift-Zustand die DB vorher war.
--
--   Effekt eines `DELETE FROM runs WHERE id = $1`:
--     runs (1)
--       → leads             (FK runs.id, ON DELETE CASCADE)
--           → lead_events     (FK leads.id, ON DELETE CASCADE)
--           → analytics_events(FK leads.id, ON DELETE CASCADE)
--           → pipeline_events (FK leads.id, ON DELETE CASCADE)
--       → pipeline_events    (FK runs.id,  ON DELETE CASCADE)
--   Damit verschwinden ALLE Lead-Slugs der gelöschten Runs aus der Tabelle
--   und der Namespace ist wieder frei.
--
--   Bunny-Assets werden NICHT von der Cascade angefasst — die
--   `bunny_asset_refs` haben bewusst keine harten FK auf die Owner-Rows
--   (polymorpher Owner_id). Das Route-Handler-Cleanup ruft daher VOR dem
--   Hard-Delete `removeBunnyAssetRefsForOwner('lead', leadId)` für jeden
--   Lead und `removeBunnyAssetRefsForOwner('run', runId)` für den Run
--   auf; der Purge-Worker (Paket B) erkennt anschließend orphane Assets
--   und löscht sie aus Bunny Stream/Storage.
--
-- Reversibel — Rollback-Block am Dateiende.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── leads.run_id  →  runs.id  (ON DELETE CASCADE) ──────────────────────────
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_run_id_runs_id_fk";
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_run_id_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── lead_events.lead_id  →  leads.id  (ON DELETE CASCADE) ──────────────────
ALTER TABLE "lead_events" DROP CONSTRAINT IF EXISTS "lead_events_lead_id_leads_id_fk";
ALTER TABLE "lead_events"
  ADD CONSTRAINT "lead_events_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── analytics_events.lead_id  →  leads.id  (ON DELETE CASCADE) ─────────────
ALTER TABLE "analytics_events" DROP CONSTRAINT IF EXISTS "analytics_events_lead_id_leads_id_fk";
ALTER TABLE "analytics_events"
  ADD CONSTRAINT "analytics_events_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── pipeline_events.run_id   →  runs.id   (ON DELETE CASCADE) ──────────────
ALTER TABLE "pipeline_events" DROP CONSTRAINT IF EXISTS "pipeline_events_run_id_runs_id_fk";
ALTER TABLE "pipeline_events"
  ADD CONSTRAINT "pipeline_events_run_id_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── pipeline_events.lead_id  →  leads.id  (ON DELETE CASCADE) ──────────────
ALTER TABLE "pipeline_events" DROP CONSTRAINT IF EXISTS "pipeline_events_lead_id_leads_id_fk";
ALTER TABLE "pipeline_events"
  ADD CONSTRAINT "pipeline_events_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Rollback (manuell ausführen, nicht von Drizzle gepickt):
--
-- BEGIN;
-- ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_run_id_runs_id_fk";
-- ALTER TABLE "leads"
--   ADD CONSTRAINT "leads_run_id_runs_id_fk"
--   FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id")
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
--
-- ALTER TABLE "lead_events" DROP CONSTRAINT IF EXISTS "lead_events_lead_id_leads_id_fk";
-- ALTER TABLE "lead_events"
--   ADD CONSTRAINT "lead_events_lead_id_leads_id_fk"
--   FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
--
-- ALTER TABLE "analytics_events" DROP CONSTRAINT IF EXISTS "analytics_events_lead_id_leads_id_fk";
-- ALTER TABLE "analytics_events"
--   ADD CONSTRAINT "analytics_events_lead_id_leads_id_fk"
--   FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
--
-- ALTER TABLE "pipeline_events" DROP CONSTRAINT IF EXISTS "pipeline_events_run_id_runs_id_fk";
-- ALTER TABLE "pipeline_events"
--   ADD CONSTRAINT "pipeline_events_run_id_runs_id_fk"
--   FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id")
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
--
-- ALTER TABLE "pipeline_events" DROP CONSTRAINT IF EXISTS "pipeline_events_lead_id_leads_id_fk";
-- ALTER TABLE "pipeline_events"
--   ADD CONSTRAINT "pipeline_events_lead_id_leads_id_fk"
--   FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
-- COMMIT;
-- ──────────────────────────────────────────────────────────────────────────
