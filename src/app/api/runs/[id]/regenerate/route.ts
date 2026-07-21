export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, customLpTemplates, leads } from "@/lib/db/schema";
import { removeStreamAssetRefsForGuids } from "@/lib/db/queries/bunny-assets";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import { pipelineQueue } from "@/worker/queue";

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

/**
 * POST /api/runs/[id]/regenerate
 *
 * Setzt eine abgeschlossene (oder fehlgeschlagene) Runde teilweise oder
 * komplett zurück und schickt Leads erneut durch die Pipeline.
 *
 * Body (optional): { mode?: "all" | "video" | "pdf" | "failed" }
 *   - "all"    (Default, back-compat): alle Outputs werden zurückgesetzt
 *              und die volle Pipeline läuft für ALLE Leads erneut.
 *   - "video": nur Video + Landingpage werden neu erzeugt. Der bestehende
 *              `pdfUrl` bleibt erhalten; die Worker überspringen die PDF-
 *              Stages (`skipPdf=true`).
 *   - "pdf":   nur das PDF-Brief wird neu erzeugt. Bestehende `videoUrl`,
 *              `thumbnailUrl` und `slug` bleiben erhalten; die Worker
 *              überspringen Render/Upload/Landingpage (`skipVideo=true`).
 *   - "failed": nur Leads mit `status='failed'` werden zurückgesetzt und
 *              durch die volle Pipeline geschickt. Bestehende erfolgreiche
 *              Outputs anderer Leads bleiben unangetastet.
 *
 * Sichtbar nur wenn der Run einen terminalen Status hat (completed /
 * failed / cancelled). Ein laufender Run wird mit 409 abgelehnt.
 */

type RegenerateMode = "all" | "video" | "pdf" | "failed";

function parseMode(input: unknown): RegenerateMode {
  if (
    input === "video" ||
    input === "pdf" ||
    input === "all" ||
    input === "failed"
  ) {
    return input;
  }
  return "all";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Body lesen ist optional — wenn nichts mitgegeben wird, behalten wir
  // das alte Verhalten ("all") bei.
  let mode: RegenerateMode = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { mode?: unknown };
      mode = parseMode(body?.mode);
    }
  } catch {
    // Leerer / kaputter Body → Default behalten.
  }

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  if (run.status === "generating") {
    return NextResponse.json(
      { error: "Runde läuft bereits — bitte warten oder abbrechen." },
      { status: 409 },
    );
  }

  // Lead-IDs in row-Reihenfolge holen — für stabile Re-enqueue-Order.
  // status wird mitselektiert, damit der "failed"-Modus die nicht-fehlgeschlagenen
  // Leads ohne Extra-Roundtrip ausfiltern kann.
  const allLeadRows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      status: leads.status,
      bunnyVideoId: leads.bunnyVideoId,
    })
    .from(leads)
    .where(eq(leads.runId, params.id));

  if (allLeadRows.length === 0) {
    return NextResponse.json(
      { error: "Keine Leads in dieser Runde." },
      { status: 400 },
    );
  }

  // "failed" beschränkt sich auf Leads mit status='failed'. Alle anderen Modi
  // operieren auf dem kompletten Lead-Set.
  const leadRows =
    mode === "failed"
      ? allLeadRows.filter((l) => l.status === "failed")
      : allLeadRows;

  if (mode === "failed" && leadRows.length === 0) {
    return NextResponse.json(
      { error: "Keine fehlgeschlagenen Leads in dieser Runde." },
      { status: 400 },
    );
  }

  leadRows.sort((a, b) => a.rowIndex - b.rowIndex);

  // Reset der Lead-Felder hängt vom Modus ab:
  //  - "all":    alle URLs werden genullt.
  //  - "video":  nur video- und landingpage-bezogene Felder; pdfUrl bleibt.
  //  - "pdf":    nur pdfUrl; video / thumbnail / slug bleiben unverändert.
  //  - "failed": volle Pipeline; URLs sind bei failed-Leads ohnehin null und
  //              werden hier nicht angefasst, um keine evtl. teilweise
  //              gesetzten Felder gewollt überschreiben zu müssen.
  // In allen Fällen: status zurück auf "pending", errorMessage / Zeitstempel
  // zurücksetzen, damit die Live-Tabelle sauber neu trackt.
  const baseReset = {
    status: "pending" as const,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    // Frischer Zähler: die Stuck-Recovery im Worker requeut nur Leads mit
    // attempts < 3 — ohne Reset würde ein manuell regenerierter Lead nach
    // vielen früheren Fehlversuchen sofort wieder als "ausgeschöpft" gelten.
    attempts: 0,
  };
  // Wichtig: `bunny_video_id` muss synchron zu `video_url` resetted werden.
  // Sonst zeigt die Landingpage spaeter via dem alten Bunny-Stream-GUID auf
  // ein Video aus einem frueheren Run (z.B. mit anderem Webcam-Source).
  // Wichtig: `videoMp4Url` muss synchron zu `videoUrl` resetted werden.
  // Sonst zeigt der Custom-LP-Renderer / Webcam-Monitor / Mediathek auf
  // einen alten Bunny-MP4-Pfad (z.B. aus einem frueheren Webcam-Asset)
  // waehrend die neue Pipeline noch laeuft → 404 fuer den User.
  const resetPatch =
    mode === "all"
      ? {
          ...baseReset,
          bunnyVideoId: null,
          videoContentHash: null,
          videoUrl: null,
          videoMp4Url: null,
          pdfUrl: null,
          thumbnailUrl: null,
        }
      : mode === "video"
        ? {
            ...baseReset,
            bunnyVideoId: null,
            videoContentHash: null,
            videoUrl: null,
            videoMp4Url: null,
            thumbnailUrl: null,
          }
        : mode === "pdf"
          ? {
              ...baseReset,
              pdfUrl: null,
            }
          : // mode === "failed": keine URLs anfassen, nur Status/Error/Timestamps
            baseReset;

  // Asset-Deref VOR dem Reset: die Modes "all"/"video" nullen gleich die
  // alten Bunny-GUIDs auf Leads + Run. Ohne das Lösen der bunny_asset_refs
  // hielte der alte Ref das Video für immer "referenziert" — der Purge-
  // Worker würde die verwaisten Videos nie aufräumen (Review-Fund 4).
  // Nur die HIER betroffenen Owner werden dereferenziert; ein evtl. noch
  // bestehender campaign_webcam-/media_item-Ref auf dieselbe GUID bleibt
  // stehen und schützt das Video weiterhin vor dem Purge.
  if (mode === "all" || mode === "video") {
    const staleGuids = new Set<string>();
    for (const lr of leadRows) {
      if (lr.bunnyVideoId) staleGuids.add(lr.bunnyVideoId);
    }
    if (run.sharedBunnyVideoId) staleGuids.add(run.sharedBunnyVideoId);
    const owners: Array<{ ownerType: "lead" | "run"; ownerId: string }> =
      leadRows.map((lr) => ({ ownerType: "lead" as const, ownerId: lr.id }));
    if (run.sharedBunnyVideoId) {
      owners.push({ ownerType: "run", ownerId: params.id });
    }
    if (staleGuids.size > 0) {
      await removeStreamAssetRefsForGuids(
        auth.user.id,
        Array.from(staleGuids),
        owners,
      ).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[runs:regenerate] asset deref failed:", err);
      });
    }
  }

  if (mode === "failed") {
    // Nur die ausgewählten failed-Lead-IDs aktualisieren — andere Leads (z.B.
    // 'completed') bleiben unverändert.
    const failedIds = leadRows.map((l) => l.id);
    await db
      .update(leads)
      .set(resetPatch)
      .where(and(eq(leads.runId, params.id), inArray(leads.id, failedIds)));
  } else {
    await db.update(leads).set(resetPatch).where(eq(leads.runId, params.id));
  }

  // Re-snapshot der aktuell aktiven Custom-LP-Version: ein Regenerate soll
  // explizit den NEUSTEN Stand der Vorlage übernehmen — sonst klebt der Run
  // an einer alten Pin-Version und der User wundert sich, warum sein Update
  // nicht ankommt.
  const customLpVersionId = await resolveActiveCustomLpVersionId(
    run.campaignId,
  );

  // Shared-Run-Video-Cache invalidieren wenn Video neu generiert werden soll.
  // Modes "all" und "video" → der User will ein frisches Video. Falls die
  // Kampagne inzwischen ein anderes Webcam-Asset referenziert, würde der
  // alte Bunny-GUID sonst weiter ausgespielt.
  const resetSharedVideo = mode === "all" || mode === "video";
  await updateRun(params.id, auth.user.id, {
    status: "generating",
    startedAt: new Date(),
    completedAt: null,
    customLpVersionId,
    ...(resetSharedVideo
      ? {
          sharedBunnyVideoId: null,
          sharedVideoUrl: null,
          sharedThumbnailUrl: null,
          sharedVideoUploadStartedAt: null,
        }
      : {}),
  });

  // Re-enqueue. Wenn Redis weg ist: rollen wir den Status NICHT zurück —
  // der User sieht "generating" und kann via separatem Worker-Requeue
  // nachhelfen. Wir geben aber eine 503 zurück damit das UI weiß was los war.
  const skipVideo = mode === "pdf";
  const skipPdf = mode === "video";
  try {
    const queue = pipelineQueue();
    // Verwaiste Retries aufräumen: von früheren Fehlversuchen können noch
    // delayed/waiting Jobs für dieselben Leads in der Queue liegen (Backoff-
    // Retry läuft z.B. noch, während der User schon regeneriert). Ohne
    // Cleanup laufen dann ZWEI Pipelines pro Lead parallel (Doppel-Upload,
    // Status-Races). Aktive Jobs können nicht entfernt werden — das fängt
    // der Lead-Status-Guard ab.
    try {
      const stale = await queue.getJobs(["delayed", "waiting", "prioritized", "paused"]);
      const targetLeadIds = new Set(leadRows.map((lr) => lr.id));
      await Promise.allSettled(
        stale
          .filter((j) => j?.data?.runId === params.id && targetLeadIds.has(j.data.leadId))
          .map((j) => j.remove()),
      );
    } catch (cleanupErr) {
      // eslint-disable-next-line no-console
      console.warn("[runs:regenerate] stale-job cleanup failed:", cleanupErr);
    }
    // BullMQ dedupliziert per jobId. Um sicher zu re-enqueuen verwenden wir
    // einen eindeutigen jobId pro Regenerate (leadId + Timestamp). Der
    // Concurrency-Schutz kommt vom Lead-Status "pending" der weiter oben
    // gesetzt wird — ein zweiter Regen-Klick auf denselben Lead ist harmlos,
    // die Pipeline-Guards springen bei bereits gesetztem PDF/Video/Envelope
    // in idempotenten Skip.
    const nowStamp = Date.now();
    await queue.addBulk(
      leadRows.map((lr) => ({
        name: "lead-pipeline",
        data: {
          leadId: lr.id,
          runId: params.id,
          userId: auth.user.id,
          campaignId: run.campaignId,
          ...(skipVideo ? { skipVideo: true } : {}),
          ...(skipPdf ? { skipPdf: true } : {}),
        },
        // WICHTIG: BullMQ verbietet ":" in Custom-jobIds — deshalb "-" statt ":"
        opts: { jobId: `${lr.id}-regen-${nowStamp}` },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[runs:regenerate] enqueue failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Leads zurückgesetzt, aber die Job-Queue ist nicht erreichbar. Bitte Worker prüfen.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode,
    totalLeads: leadRows.length,
    retried: leadRows.length,
  });
}
