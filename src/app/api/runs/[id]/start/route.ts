export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  campaigns,
  customLpTemplates,
  leads,
  runs,
  type RemovedDetail,
} from "@/lib/db/schema";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import {
  bulkInsertLeads,
  softRemoveLeads,
  type BulkLeadRow,
} from "@/lib/db/queries/leads";
import {
  enqueueForPreflight,
  enqueueApprovedLeadsForPhase2,
} from "@/lib/preflight/job-enqueue";
import { sql } from "drizzle-orm";
import { detectDuplicates } from "@/lib/dedupe/engine";
import type { DedupeConfig } from "@/lib/dedupe/types";

/**
 * Looks up the active Custom-LP-Version-ID for a campaign at the moment a run
 * starts. Returns null if the campaign has no Custom-LP-Template bound, or if
 * the template has no active version (edge-case: ZIP uploaded but never
 * activated — we degrade silently and the run uses the Block-LP / default).
 */
async function resolveActiveCustomLpVersionId(
  campaignId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      customLpTemplateId: campaigns.customLpTemplateId,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(campaigns)
    .leftJoin(
      customLpTemplates,
      eq(customLpTemplates.id, campaigns.customLpTemplateId),
    )
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || !row.customLpTemplateId) return null;
  return row.activeVersionId ?? null;
}

interface StoredColumnMapping {
  mapping?: Record<string, string>;
  parsed?: {
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
  };
}

/**
 * POST /api/runs/[id]/start
 *
 * NEUE SEMANTIK (Lead-Quality-Check / Preflight-Phase):
 *
 *   1. Loads the run + parsed-rows + mapping blob.
 *   2. For each parsed row: applies the mapping (placeholder → original
 *      column value) to produce the lead's `data` payload — original
 *      columns are kept too so the export later still has everything.
 *   3. Bulk-inserts leads. Flips run.status to **'preflighting'** (statt
 *      direkt 'generating'). Snapshot der aktiven Custom-LP-Version bleibt
 *      bestehen, weil sie pro Run immutable sein soll — der User darf an
 *      seinem Template feilen, ohne dass laufende Runs es mitbekommen.
 *   4. Ruft `enqueueForPreflight()` auf:
 *        - inline-validation (Pflichtfelder, URL-Format, Email-Format)
 *        - duplicate-detection (host + email)
 *        - inline-disqualifizierte Leads bekommen direkt einen terminalen
 *          `preflight_status` OHNE Worker-Job
 *        - alle übrigen Leads landen in der `lead-preflight`-Queue
 *   5. Returns `{ ok, totalLeads, queuedForPreflight, alreadyDisqualified }`.
 *
 * Phase 2 (das alte `lead-pipeline` enqueue) wird hier NICHT mehr getriggert.
 * Sie startet erst, wenn der Operator über `/api/runs/[id]/preflight/approve`
 * den Run freigibt — siehe `enqueueApprovedLeadsForPhase2()` im
 * `job-enqueue.ts`-Helper.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const cm = (run.columnMapping as StoredColumnMapping | null) ?? {};
  if (!cm.parsed || cm.parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "Keine Leads hochgeladen." },
      { status: 400 },
    );
  }
  if (!cm.mapping || Object.keys(cm.mapping).length === 0) {
    return NextResponse.json(
      { error: "Spalten-Mapping fehlt." },
      { status: 400 },
    );
  }
  // Guard: ein Run, der bereits in einem aktiven Pipeline-Status ist, darf
  // nicht doppelt gestartet werden. `preflighting`, `awaiting_approval`,
  // `approved` und `generating` sind alle "läuft schon".
  const activeStatuses: Array<typeof run.status> = [
    "preflighting",
    "awaiting_approval",
    "approved",
    "generating",
  ];
  if (activeStatuses.includes(run.status)) {
    return NextResponse.json(
      { error: "Runde läuft bereits." },
      { status: 409 },
    );
  }

  // Guard: same run shouldn't insert leads twice.
  const [existing] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.runId, params.id))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "Leads bereits angelegt." },
      { status: 409 },
    );
  }

  const mapping = cm.mapping;
  const rowsIn = cm.parsed.rows;

  const bulkRows: BulkLeadRow[] = rowsIn.map((row, index) => {
    // Original columns + flattened mapped values (placeholder names) so the
    // worker pipeline can look up `data.firstName` etc. AND keep `data.<col>`.
    const data: Record<string, string> = { ...row };
    for (const [placeholder, columnName] of Object.entries(mapping)) {
      // System-Sentinel (z.B. `@system:pageUrl`) wird NICHT aus den CSV-
      // Daten befüllt — der Wert kommt erst beim Render aus der Pipeline
      // (siehe buildDocxVars in pipeline.ts). Wir lassen das `data`-Feld
      // leer, damit kein CSV-Lookup auf `@system:...` läuft.
      if (typeof columnName === "string" && columnName.startsWith("@system:")) {
        continue;
      }
      if (columnName && row[columnName] !== undefined) {
        data[placeholder] = row[columnName];
      }
    }
    return { rowIndex: index, data };
  });

  const inserted = await bulkInsertLeads(params.id, bulkRows, run.campaignId);

  // ── Paket C: Duplikat-Erkennung (Dedupe) ────────────────────────────────
  //
  // Wir laden die `dedupeConfig` aus der DB (vom Wizard via PUT
  // /api/runs/[id]/dedupe-config persistiert). Wenn nichts gesetzt ist
  // oder explizit disabled, läuft der Block durch ohne Effekt — der
  // klassische Pfad bleibt unverändert.
  //
  // Reihenfolge:
  //   1. detectDuplicates() läuft über die ORIGINAL-Rows (rowsIn) — gleiche
  //      Datengrundlage, die der User im Wizard gesehen hat.
  //   2. Für jeden excluded RowIndex bauen wir das `RemovedDetail`-Payload
  //      (matchedRule + duplicateOfRowIndex) und mappen es über (runId,
  //      rowIndex) → leadId.
  //   3. softRemoveLeads(..., 'duplicate', detailMap) schreibt removedAt +
  //      removedReason + removedDetail in einer Transaktion.
  //
  // Auswirkung auf nachfolgende Schritte:
  //   - `enqueueForPreflight` filtert `removedAt IS NULL` → Duplikate
  //     bekommen KEINEN BullMQ-Job (Skip-Garantie erfüllt).
  //   - Webcam-Skip-Pfad: das UPDATE-Approval filtert ebenfalls
  //     `removedAt IS NULL` (siehe weiter unten), Duplikate werden nicht
  //     mit-approved.
  let dedupeRemovedCount = 0;
  const [runDedupeRow] = await db
    .select({ dedupeConfig: runs.dedupeConfig })
    .from(runs)
    .where(eq(runs.id, params.id))
    .limit(1);
  const dedupeConfig = (runDedupeRow?.dedupeConfig as DedupeConfig | null) ?? null;
  if (
    dedupeConfig &&
    dedupeConfig.enabled &&
    Array.isArray(dedupeConfig.rules) &&
    dedupeConfig.rules.length > 0
  ) {
    const dedupeResult = detectDuplicates(rowsIn, dedupeConfig);
    if (dedupeResult.excludedRowIndices.size > 0) {
      const excludedRowIdxs = Array.from(dedupeResult.excludedRowIndices);

      // rowIndex → leadId Lookup. bulkInsertLeads liefert nur Count zurück;
      // wir gehen DB-authoritativ via (runId, rowIndex).
      const dupeLeads = await db
        .select({ id: leads.id, rowIndex: leads.rowIndex })
        .from(leads)
        .where(
          and(
            eq(leads.runId, params.id),
            inArray(leads.rowIndex, excludedRowIdxs),
          ),
        );

      const detailByLeadId = new Map<string, RemovedDetail>();
      const leadIdsToRemove: string[] = [];
      for (const row of dupeLeads) {
        const reason = dedupeResult.reasonByRowIndex.get(row.rowIndex);
        if (!reason) continue;
        leadIdsToRemove.push(row.id);
        detailByLeadId.set(row.id, {
          reason: "duplicate",
          matchedRule: {
            id: reason.ruleId,
            label: reason.ruleLabel,
            columns: reason.matchedColumns,
          },
          duplicateOfRowIndex: reason.originalRowIndex,
        });
      }

      if (leadIdsToRemove.length > 0) {
        dedupeRemovedCount = await softRemoveLeads(
          leadIdsToRemove,
          params.id,
          auth.user.id,
          "duplicate",
          detailByLeadId,
        );
      }
    }
  }

  // ── Paket E: Pflicht-Spalten-Validierung (incomplete_data) ───────────────
  //
  // Reihenfolge im Endpoint (Vertrag mit Paket C):
  //   1. Paket C: Dedupe-Engine — markiert Duplikat-Leads als removed.
  //   2. HIER:    incomplete_data — markiert Leads mit leeren Pflichtfeldern.
  //   3. Phase-1-Enqueue (`enqueueForPreflight`) bzw. Webcam-Skip-Pfad —
  //      `getLeadsForPreflightStart` / `enqueueApprovedLeadsForPhase2`
  //      filtern `isNull(removedAt)`, also werden beide unsere und Paket-C's
  //      soft-deleted Leads sauber übersprungen. KEIN gemeinsames `excludedIds`-
  //      Set notwendig — die DB-Spalte `removed_at` IST der gemeinsame Filter.
  //
  // Hinweis: solange Paket C noch nicht gelandet ist, ist diese Stelle die
  // einzige Dedupe-/Validierungs-Schicht oberhalb der Preflight-Queue. Sobald
  // Paket C den Dedupe-Block davor einzieht, erweitert er entweder
  //   (a) seinen eigenen soft-delete vor diesem Block, oder
  //   (b) übergibt mir ein `dedupeExcludedRowIndices: Set<number>` damit wir
  //       Duplikate hier nicht nochmal als incomplete markieren.
  // Beide Varianten funktionieren mit der unten gewählten "rowIndex IN ..."-
  // Strategie ohne Anpassung — wir markieren NUR Rows, die incomplete sind,
  // ein bereits soft-deleted Lead bekommt unten halt einen zweiten
  // `removedReason`-Stempel (wäre semantisch falsch; deshalb prüfen wir vor
  // dem Update via `isNull(leads.removedAt)`).
  let incompleteCount = 0;
  // System-Sentinel (z.B. `@system:pageUrl`) sind KEINE Pflicht-CSV-Spalten —
  // die werden zur Render-Zeit befüllt. Aus der required-Liste filtern,
  // damit Leads NICHT als „Daten unvollständig" markiert werden, nur weil
  // die System-Spalte natürlich nicht in der CSV vorkommt.
  const requiredCols = Object.values(mapping).filter(
    (v): v is string =>
      typeof v === "string" && v.trim() !== "" && !v.startsWith("@system:"),
  );
  if (requiredCols.length > 0) {
    const incompleteByRowIndex = new Map<number, string[]>();
    for (let i = 0; i < rowsIn.length; i++) {
      const row = rowsIn[i];
      const missing: string[] = [];
      for (const col of requiredCols) {
        const val = row[col];
        if (typeof val !== "string" || val.trim().length === 0) {
          missing.push(col);
        }
      }
      if (missing.length > 0) {
        incompleteByRowIndex.set(i, missing);
      }
    }

    incompleteCount = incompleteByRowIndex.size;
    if (incompleteByRowIndex.size > 0) {
      // Lead-IDs zu den incomplete-Rows holen. `(runId, rowIndex)` ist
      // implizit eindeutig pro Run (bulkInsertLeads schreibt 1:1 vom Array-
      // Index). Wir bestehen NICHT auf den `inserted: number`-Returnwert von
      // bulkInsertLeads, weil der nur einen Count liefert — der Lookup über
      // rowIndex ist sowieso DB-authoritative.
      const rowIdxs = Array.from(incompleteByRowIndex.keys());
      const incompleteLeads = await db
        .select({ id: leads.id, rowIndex: leads.rowIndex })
        .from(leads)
        .where(
          and(
            eq(leads.runId, params.id),
            inArray(leads.rowIndex, rowIdxs),
            // Paket C: bereits via Dedupe entfernte Leads NICHT erneut stempeln —
            // sonst überschreiben wir den `duplicate`-Reason mit
            // `incomplete_data`. `duplicate` gewinnt by spec (Paket C läuft
            // zuerst, Paket E nur auf nicht-removed Leads).
            isNull(leads.removedAt),
          ),
        );

      // Pro Lead ein einzelnes UPDATE — `removedDetail` ist je-Lead-individuell
      // (verschiedene `missingColumns`), daher kein CASE-WHEN-Batch. Bei
      // realistischen Run-Größen (≤10k Leads, davon vielleicht <5 % incomplete)
      // ist das problemlos; bei deutlich größeren Volumina wäre ein
      // `unnest`-basierter Bulk-UPDATE die nächste Optimierung.
      const now = new Date();
      await Promise.all(
        incompleteLeads.map((row) => {
          const missingColumns = incompleteByRowIndex.get(row.rowIndex) ?? [];
          const detail: RemovedDetail = {
            reason: "incomplete_data",
            missingColumns,
          };
          return db
            .update(leads)
            .set({
              removedAt: now,
              removedReason: "incomplete_data",
              removedDetail: detail,
            })
            .where(eq(leads.id, row.id));
        }),
      );
    }
  }

  // Snapshot the campaign's active Custom-LP version onto the run, so future
  // template edits do not silently change what THIS run delivers.
  const customLpVersionId = await resolveActiveCustomLpVersionId(
    run.campaignId,
  );

  // Kampagnen-Modus laden. Bei `webcam-only` wird das Video nur aus dem
  // Webcam-Clip rendert (kein Webseite-Screencast) — eine URL-Probe + Vorab-
  // Screenshot wäre dann nutzlos, weil die Lead-URL gar nicht ins Video
  // einfließt. In diesem Fall überspringen wir Phase 1 komplett.
  const [campaignRow] = await db
    .select({ mode: campaigns.mode })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  const skipPreflight = campaignRow?.mode === "webcam-only";

  if (skipPreflight) {
    // ── Direkter Phase-2-Pfad ────────────────────────────────────────────
    // Alle Leads kriegen einen Auto-Approve-Stempel. preflight_status='ok'
    // ist semantisch korrekt ("nichts zu prüfen — durchgewunken").
    // Paket E: incomplete_data soft-deleted Leads (removedAt != NULL) NICHT
    // approven — sonst stempeln wir einen approved-Marker auf einen entfernten
    // Lead, was die Counts in `runs.approvedLeadCount` verfälschen würde und
    // semantisch ein "approved + removed"-Widerspruch wäre.
    await db
      .update(leads)
      .set({
        preflightStatus: "ok",
        approvedAt: sql`NOW()`,
        preflightCompletedAt: sql`NOW()`,
      })
      .where(and(eq(leads.runId, params.id), isNull(leads.removedAt)));

    await updateRun(params.id, auth.user.id, {
      status: "approved",
      startedAt: new Date(),
      totalLeads: inserted,
      // Paket C+E: soft-deleted Leads (duplicate + incomplete_data) sind
      // NICHT approved.
      approvedLeadCount: inserted - incompleteCount - dedupeRemovedCount,
      customLpVersionId,
    });

    await db
      .update(runs)
      .set({
        columnMapping: { mapping } as unknown as Record<string, string>,
      })
      .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

    try {
      await enqueueApprovedLeadsForPhase2(params.id, auth.user.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[runs:start] phase-2 enqueue failed:", err);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Leads angelegt, aber die Job-Queue ist nicht erreichbar. Worker prüfen.",
          totalLeads: inserted,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      preflightSkipped: true,
      totalLeads: inserted,
      queuedForPreflight: 0,
      alreadyDisqualified: 0,
      dedupeRemoved: dedupeRemovedCount,
    });
  }

  // ── Phase-1-Pfad (Default für `with-presentation`) ─────────────────────
  await updateRun(params.id, auth.user.id, {
    status: "preflighting",
    preflightStartedAt: new Date(),
    totalLeads: inserted,
    customLpVersionId,
  });

  await db
    .update(runs)
    .set({
      columnMapping: { mapping } as unknown as Record<string, string>,
    })
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

  let enqueueResult;
  try {
    enqueueResult = await enqueueForPreflight(
      params.id,
      auth.user.id,
      run.campaignId,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[runs:start] preflight enqueue failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Leads angelegt, aber die Preflight-Queue ist nicht erreichbar. " +
          "Bitte Worker prüfen — der Recovery-Pass holt den Run beim nächsten Boot ab.",
        totalLeads: inserted,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    preflightSkipped: false,
    totalLeads: enqueueResult.totalLeads,
    queuedForPreflight: enqueueResult.queuedForPreflight,
    alreadyDisqualified: enqueueResult.alreadyDisqualified,
    dedupeRemoved: dedupeRemovedCount,
  });
}
