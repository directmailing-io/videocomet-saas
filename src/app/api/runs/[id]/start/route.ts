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
  type RunAbConfig,
} from "@/lib/db/schema";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
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
import { coversEmptyValue } from "@/lib/placeholders/substitute";

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
  placeholderMapping?: import("@/lib/placeholders/types").PlaceholderMapping;
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
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Optionaler Body: A/B-Split-Regel aus dem Runden-Wizard. Der Endpoint
  // wurde historisch ohne Body aufgerufen — ein fehlender/leerer Body ist
  // weiterhin gültig.
  let abRequest: { mode: "random" | "sequential"; weightA: number } | null = null;
  // Opt-out der Screenshot-Vorprüfung (Phase 1) für diese Runde. Der User
  // entscheidet im Runden-Wizard per Toggle — ohne Vorprüfung gehen alle
  // Leads direkt in die Produktion (Auto-Approve-Pfad wie bei webcam-only).
  let skipPreflightRequested = false;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && body.skipPreflight === true) {
      skipPreflightRequested = true;
    }
    if (body && typeof body === "object" && body.ab) {
      const mode = body.ab.mode;
      const weightA = Number(body.ab.weightA);
      if (
        (mode === "random" || mode === "sequential") &&
        Number.isInteger(weightA) &&
        weightA >= 10 &&
        weightA <= 90
      ) {
        abRequest = { mode, weightA };
      } else {
        return NextResponse.json(
          { error: "Ungültige A/B-Test-Konfiguration." },
          { status: 400 },
        );
      }
    }
  } catch {
    // kein/kein-JSON-Body → kein A/B-Request
  }

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

  // ── BILLING-GATE ────────────────────────────────────────────────────────
  // 1) Subscription aktiv? (past_due gilt noch bis Gnadenfrist-Ende)
  // 2) Credit-Balance >= geplante Lead-Zahl?
  // Wir muessen VOR dem bulkInsertLeads pruefen — sonst haben wir Leads
  // in der DB die nie generiert werden koennen.
  const rowsIn = cm.parsed.rows;
  const plannedLeadCount = rowsIn.length;
  // Kampagnen mit personalisierter Video-Begrüßung (intro_enabled)
  // reservieren konservativ 2 Credits pro Lead — der tatsächliche Charge
  // pro Lead ist 2 (Intro generiert) bzw. 1 (Fallback).
  const [campaignBilling] = await db
    .select({ introEnabled: campaigns.introEnabled })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  const pricePerVideo = campaignBilling?.introEnabled ? 2 : 1;
  try {
    const { assertBillingReadyForRun } = await import(
      "@/lib/billing/run-gate"
    );
    await assertBillingReadyForRun({
      userId: auth.user.id,
      plannedLeadCount,
      pricePerVideo,
    });
  } catch (err) {
    if (err && typeof err === "object" && "kind" in err) {
      const billingErr = err as { kind: string; message: string; details?: unknown };
      if (billingErr.kind === "no_subscription") {
        return NextResponse.json(
          {
            error: billingErr.message,
            errorKind: "no_subscription",
          },
          { status: 402 },
        );
      }
      if (billingErr.kind === "insufficient_credits") {
        return NextResponse.json(
          {
            error: billingErr.message,
            errorKind: "insufficient_credits",
            details: billingErr.details,
          },
          { status: 402 },
        );
      }
    }
    throw err;
  }

  const mapping = cm.mapping;

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
  // Nur der VORNAME ist wirklich kritisch fuer Personalisierung („Servus
  // Vorname,"). Alle anderen Placeholders (E-Mail, Ort, Firma, Telefon,
  // etc.) sind optional — leere Werte werden vom Placeholder-Renderer
  // als leere Strings substituiert, der Brief funktioniert trotzdem.
  // 2026-08-06 Regression-Fix: vorher waren ALLE gemappten Felder Pflicht;
  // dadurch wurden 60% der Leads unsichtbar rausgefiltert wenn z.B. die
  // E-Mail-Spalte gemappt aber im CSV leer war (Daniels Fall: 144/243
  // Leads verschwanden weil ohne E-Mail).
  //
  // System-Sentinel (z.B. `@system:pageUrl`) werden zur Render-Zeit
  // befuellt — nie aus der required-Liste.
  const VORNAME_PLACEHOLDER_KEYS = new Set(["vorname", "firstname", "first_name"]);
  const requiredCols: string[] = [];
  for (const [placeholderKey, columnName] of Object.entries(mapping)) {
    if (typeof columnName !== "string" || columnName.trim() === "") continue;
    if (columnName.startsWith("@system:")) continue;
    if (!VORNAME_PLACEHOLDER_KEYS.has(placeholderKey.toLowerCase())) continue;
    // 2026-08-07: Wenn der User im Mapping für den Vornamen einen Fallback,
    // „leer lassen" oder eine is_empty-Regel hinterlegt hat, ist eine leere
    // Zelle abgedeckt — der Renderer substituiert dann. Solche Leads dürfen
    // NICHT als incomplete_data aussortiert werden (DigiSpace 2026-08-07:
    // komplett leere Vorname-Spalte killte alle 8 Leads ohne Ausweg).
    if (coversEmptyValue(cm.placeholderMapping?.[placeholderKey])) continue;
    // Mehrere Vorname-Keys (vorname + firstName) zeigen meist auf dieselbe
    // Spalte — nicht doppelt in missingColumns listen.
    if (!requiredCols.includes(columnName)) requiredCols.push(columnName);
  }
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

  // Gemeinsamer Fehlertext für „alle Leads aussortiert" (beide Start-Pfade).
  // WICHTIG: Dedupe prüft NUR innerhalb der hochgeladenen Liste — es gibt
  // keine rundenübergreifende Duplikat-Prüfung. Frühere Formulierung
  // („Duplikate aus früheren Runden") war falsch und hat Support-Verwirrung
  // ausgelöst (DigiSpace 2026-08-07).
  function buildAllRemovedError(inserted: number): string {
    const parts: string[] = [];
    if (dedupeRemovedCount > 0) {
      parts.push(
        `${dedupeRemovedCount} ${dedupeRemovedCount === 1 ? "Duplikat" : "Duplikate"} innerhalb dieser Liste`,
      );
    }
    if (incompleteCount > 0) {
      parts.push(
        `${incompleteCount} ohne Vornamen (Spalte ${requiredCols.map((c) => `„${c}“`).join(", ")} ist leer)`,
      );
    }
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    const hint =
      incompleteCount > 0
        ? " Tipp: Wähle im Spalten-Mapping eine gefüllte Spalte für den Vornamen oder hinterlege dort einen Standardwert."
        : " Bitte prüfe deine Liste und starte eine neue Runde.";
    return `Alle ${inserted} Leads wurden beim Import aussortiert${detail}.${hint}`;
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
    .select({
      mode: campaigns.mode,
      introEnabled: campaigns.introEnabled,
      webcamMediaId: campaigns.webcamMediaId,
      abTestingEnabled: campaigns.abTestingEnabled,
      pdfEnabled: campaigns.pdfEnabled,
      pdfGoogleDocsUrl: campaigns.pdfGoogleDocsUrl,
      pdfGoogleDocsUrlB: campaigns.pdfGoogleDocsUrlB,
      abSplitMode: campaigns.abSplitMode,
      abSplitWeightA: campaigns.abSplitWeightA,
    })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  const skipPreflight =
    campaignRow?.mode === "webcam-only" || skipPreflightRequested;

  // ── A/B-Test: Varianten-Zuteilung ────────────────────────────────────────
  //
  // Läuft NACH Dedupe + Validierung, damit nur echte (nicht-removed) Leads
  // in die Quote zählen. Die Regel + beide Brief-URLs werden als Snapshot in
  // `runs.abConfig` eingefroren — spätere Kampagnen-Änderungen (Test
  // deaktivieren, Gewinner übernehmen) ändern laufende Runden nicht.
  //
  // Exakte Quote statt Münzwurf: bei "random" wird per Fisher-Yates
  // geshuffelt und exakt round(n·weightA%) Leads bekommen A — ein
  // Bernoulli-Wurf pro Lead würde bei kleinen Listen stark streuen.
  let abConfig: RunAbConfig | null = null;
  const abActive =
    campaignRow?.abTestingEnabled === true &&
    campaignRow.pdfEnabled === true &&
    typeof campaignRow.pdfGoogleDocsUrl === "string" &&
    campaignRow.pdfGoogleDocsUrl.trim() !== "" &&
    typeof campaignRow.pdfGoogleDocsUrlB === "string" &&
    campaignRow.pdfGoogleDocsUrlB.trim() !== "";
  if (abActive) {
    // Wizard schickt die Regel mit; Fallback (z.B. API-Aufrufe ohne Body):
    // Standard-Verteilung der Kampagne (Migration 0035).
    const rule = abRequest ?? {
      mode: campaignRow.abSplitMode,
      weightA: campaignRow.abSplitWeightA,
    };
    abConfig = {
      mode: rule.mode,
      weightA: rule.weightA,
      urlA: campaignRow.pdfGoogleDocsUrl!.trim(),
      urlB: campaignRow.pdfGoogleDocsUrlB!.trim(),
    };

    const eligible = await db
      .select({ id: leads.id, rowIndex: leads.rowIndex })
      .from(leads)
      .where(and(eq(leads.runId, params.id), isNull(leads.removedAt)))
      .orderBy(leads.rowIndex);

    const countA = Math.round((rule.weightA / 100) * eligible.length);
    let idsA: string[];
    if (rule.mode === "sequential") {
      idsA = eligible.slice(0, countA).map((l) => l.id);
    } else {
      const shuffled = [...eligible];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      idsA = shuffled.slice(0, countA).map((l) => l.id);
    }
    const idsASet = new Set(idsA);
    const idsB = eligible.filter((l) => !idsASet.has(l.id)).map((l) => l.id);

    if (idsA.length > 0) {
      await db
        .update(leads)
        .set({ abVariant: "A" })
        .where(inArray(leads.id, idsA));
    }
    if (idsB.length > 0) {
      await db
        .update(leads)
        .set({ abVariant: "B" })
        .where(inArray(leads.id, idsB));
    }
  }

  if (skipPreflight) {
    // ── Direkter Phase-2-Pfad ────────────────────────────────────────────
    // Alle Leads kriegen einen Auto-Approve-Stempel. preflight_status='ok'
    // ist semantisch korrekt ("nichts zu prüfen — durchgewunken").
    // Paket E: incomplete_data soft-deleted Leads (removedAt != NULL) NICHT
    // approven — sonst stempeln wir einen approved-Marker auf einen entfernten
    // Lead, was die Counts in `runs.approvedLeadCount` verfälschen würde und
    // semantisch ein "approved + removed"-Widerspruch wäre.
    const stamped = await db
      .update(leads)
      .set({
        preflightStatus: "ok",
        approvedAt: sql`NOW()`,
        preflightCompletedAt: sql`NOW()`,
      })
      .where(and(eq(leads.runId, params.id), isNull(leads.removedAt)))
      .returning({ id: leads.id });

    // Guard: Wenn Dedupe + Pflichtfeld-Validierung ALLE Leads aussortiert
    // haben, gibt es nichts zu produzieren. Ohne diesen Abbruch ginge der
    // Run auf approved/generating und bliebe für immer bei „Warte auf den
    // ersten Worker" hängen (DigiSpace-Incident 2026-08-06).
    if (stamped.length === 0) {
      await updateRun(params.id, auth.user.id, {
        status: "failed",
        totalLeads: inserted,
        approvedLeadCount: 0,
      });
      await insertPipelineEvent({
        runId: params.id,
        level: "error",
        stage: "start",
        message: `Runde gestoppt: ${buildAllRemovedError(inserted)}`,
      });
      return NextResponse.json(
        {
          ok: false,
          error: buildAllRemovedError(inserted),
          totalLeads: inserted,
          dedupeRemoved: dedupeRemovedCount,
          incomplete: incompleteCount,
        },
        { status: 422 },
      );
    }

    // ── Intro-Vorschau-Gate für webcam-only ──────────────────────────────
    // Webcam-only überspringt zwar die Screenshot-Vorprüfung, aber Kampagnen
    // mit aktivierter personalisierter Begrüßung brauchen IMMER ein Gate:
    //   - Voice+Kalibrierung ready → Preview-Runde, User bestätigt.
    //   - Sonst → auch awaiting_approval, aber mit sofortigem
    //     „preview finished, 0 entries"-Marker; UI zeigt die Fehler-Karte
    //     mit „ohne KI-Begrüßung produzieren"-Option.
    // Ohne dieses Gate rennt der Direkt-Pfad in Vollproduktion, obwohl der
    // User eigentlich eine personalisierte Begrüßung wollte.
    if (campaignRow?.introEnabled === true && campaignRow.webcamMediaId) {
      const { voiceProfiles, introCalibrations } = await import(
        "@/lib/db/schema"
      );
      const [voice] = await db
        .select({ status: voiceProfiles.status })
        .from(voiceProfiles)
        .where(eq(voiceProfiles.userId, auth.user.id))
        .limit(1);
      const [calib] = await db
        .select({ status: introCalibrations.status })
        .from(introCalibrations)
        .where(eq(introCalibrations.mediaItemId, campaignRow.webcamMediaId))
        .limit(1);
      const introReady =
        voice?.status === "ready" && calib?.status === "ready";

      await updateRun(params.id, auth.user.id, {
        status: "awaiting_approval",
        preflightStartedAt: new Date(),
        preflightCompletedAt: new Date(),
        totalLeads: inserted,
        approvedLeadCount: inserted - incompleteCount - dedupeRemovedCount,
        customLpVersionId,
        abConfig,
      });

      await db
        .update(runs)
        .set({
          // placeholderMapping muss den Start überleben (s.u.).
          columnMapping: {
            mapping,
            ...(cm.placeholderMapping
              ? { placeholderMapping: cm.placeholderMapping }
              : {}),
          } as unknown as Record<string, string>,
          // Wenn kein Preview-Job laufen kann: sofortiger „fertig, leer"
          // -Marker. UI unterscheidet dank sqlite completed_at + leerem
          // Array den Fall „konnte nicht erstellt werden" vom Spinner.
          ...(introReady
            ? {}
            : {
                introPreview: [],
                introPreviewCompletedAt: new Date(),
              }),
        })
        .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

      if (introReady) {
        try {
          const { enqueueIntroPreviewJob } = await import(
            "@/worker/intro-queue"
          );
          await enqueueIntroPreviewJob(params.id);
        } catch (err) {
          // Best effort — der Recovery-Watcher im Worker enqueued Previews
          // für awaiting_approval-Runs nicht nach, aber der User kann die
          // Runde über die Review-Seite trotzdem freigeben.
          // eslint-disable-next-line no-console
          console.error("[runs:start] intro-preview enqueue failed:", err);
        }
      }

      return NextResponse.json({
        ok: true,
        preflightSkipped: false,
        introPreviewPending: introReady,
        introReady,
        totalLeads: inserted,
        queuedForPreflight: 0,
        alreadyDisqualified: 0,
        dedupeRemoved: dedupeRemovedCount,
      });
    }

    await updateRun(params.id, auth.user.id, {
      status: "approved",
      startedAt: new Date(),
      totalLeads: inserted,
      // Paket C+E: soft-deleted Leads (duplicate + incomplete_data) sind
      // NICHT approved.
      approvedLeadCount: inserted - incompleteCount - dedupeRemovedCount,
      customLpVersionId,
      abConfig,
    });

    await db
      .update(runs)
      .set({
        // `parsed` wird bewusst verworfen (Leads sind jetzt in der leads-
        // Tabelle), aber `placeholderMapping` MUSS überleben — die Pipeline
        // liest daraus die Wenn-Dann-Regeln + Fallbacks.
        columnMapping: {
          mapping,
          ...(cm.placeholderMapping
            ? { placeholderMapping: cm.placeholderMapping }
            : {}),
        } as unknown as Record<string, string>,
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
  // Gleicher Guard wie im skipPreflight-Pfad: ohne einen einzigen nicht-
  // removed Lead bliebe der Run für immer in `preflighting` (die Run-
  // Finalization im Worker verlangt mindestens einen aktiven Lead).
  const [eligibleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.runId, params.id), isNull(leads.removedAt)));
  if ((eligibleCount?.count ?? 0) === 0) {
    await updateRun(params.id, auth.user.id, {
      status: "failed",
      totalLeads: inserted,
      approvedLeadCount: 0,
    });
    await insertPipelineEvent({
      runId: params.id,
      level: "error",
      stage: "start",
      message: `Runde gestoppt: Alle ${inserted} Leads wurden beim Import aussortiert (${dedupeRemovedCount} Duplikate aus früheren Runden, ${incompleteCount} mit unvollständigen Pflichtfeldern).`,
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Alle ${inserted} Leads wurden beim Import aussortiert (${dedupeRemovedCount} Duplikate aus früheren Runden, ${incompleteCount} mit unvollständigen Pflichtfeldern). Es gibt nichts zu produzieren — bitte prüfe deine Liste und starte eine neue Runde.`,
        totalLeads: inserted,
        dedupeRemoved: dedupeRemovedCount,
        incomplete: incompleteCount,
      },
      { status: 422 },
    );
  }

  await updateRun(params.id, auth.user.id, {
    status: "preflighting",
    preflightStartedAt: new Date(),
    totalLeads: inserted,
    customLpVersionId,
    abConfig,
  });

  await db
    .update(runs)
    .set({
      // Wie oben: placeholderMapping (Regeln/Fallbacks) muss den Start
      // überleben, nur `parsed` wird verworfen.
      columnMapping: {
        mapping,
        ...(cm.placeholderMapping
          ? { placeholderMapping: cm.placeholderMapping }
          : {}),
      } as unknown as Record<string, string>,
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
