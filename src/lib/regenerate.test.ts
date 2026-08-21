/**
 * regenerateLeadCore / regenerateRunCore — Routing-Entscheidungen.
 *
 * Regressionstests zum Kristina-Incident (2026-08-21): Ein manuelles
 * "Neu generieren" mit Video-Anteil MUSS den historischen Intro-Snapshot
 * (introStatus/introResult) nullen und die Leads über die
 * `intro-generation`-Staging-Queue schicken — sonst überlebt ein
 * introStatus='disabled' aus einer Runde mit damals kaputter Kalibrierung
 * jeden Regen und das Video bleibt für immer ohne KI-Begrüßung.
 *
 * `@/lib/db` ist ein tabellen-basiertes Mock (siehe run-readiness.test.ts):
 * jede select-Chain auf TABLE liefert die für TABLE hinterlegten Rows,
 * egal welche Chain-Methoden (where/limit/leftJoin) dazwischen liegen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: new Map<unknown, unknown[]>(),
  updates: [] as Array<{ table: unknown; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/db", () => {
  const chain = (table: unknown) => {
    const rows = () => state.tables.get(table) ?? [];
    const builder: Record<string, unknown> = {};
    for (const m of ["where", "limit", "leftJoin", "innerJoin", "orderBy"]) {
      builder[m] = () => builder;
    }
    builder.then = (
      resolve: (v: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(rows()).then(resolve, reject);
    return builder;
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => chain(table) }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => {
          state.updates.push({ table, patch });
          return { where: () => Promise.resolve() };
        },
      }),
    },
  };
});

const enqueueLeadsForIntroStaging = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/preflight/job-enqueue", () => ({
  enqueueLeadsForIntroStaging,
}));

const updateRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db/queries/runs", () => ({ updateRun }));

const queueAdd = vi.hoisted(() => vi.fn(async () => {}));
const queueAddBulk = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/worker/queue", () => ({
  pipelineQueue: () => ({
    add: queueAdd,
    addBulk: queueAddBulk,
    getJobs: async () => [],
  }),
}));

vi.mock("@/lib/db/queries/bunny-assets", () => ({
  removeStreamAssetRefsForGuids: vi.fn(async () => {}),
}));

vi.mock("@/lib/bunny/storage", () => ({
  parseStorageUrl: () => null,
  deleteFile: vi.fn(async () => {}),
}));

import { campaigns, leads } from "@/lib/db/schema";
import { regenerateLeadCore, regenerateRunCore } from "./regenerate";

function setCampaign(introEnabled: boolean) {
  state.tables.set(campaigns, [
    { introEnabled, customLpTemplateId: null, activeVersionId: null },
  ]);
}

function leadUpdatePatches(): Array<Record<string, unknown>> {
  return state.updates.filter((u) => u.table === leads).map((u) => u.patch);
}

const LEAD_INPUT = {
  leadId: "lead-1",
  runId: "run-1",
  campaignId: "camp-1",
  ownerUserId: "user-1",
  runStatus: "completed",
  rowIndex: 0,
};

const RUN = {
  id: "run-1",
  userId: "user-1",
  campaignId: "camp-1",
  status: "completed",
  sharedBunnyVideoId: null,
};

function setLeads(
  rows: Array<{ status?: string; id?: string; rowIndex?: number }>,
) {
  state.tables.set(
    leads,
    rows.map((r, i) => ({
      id: r.id ?? `lead-${i + 1}`,
      rowIndex: r.rowIndex ?? i,
      status: r.status ?? "completed",
      bunnyVideoId: null,
      pdfUrl: null,
      envelopePdfUrl: null,
      thumbnailUrl: null,
    })),
  );
}

beforeEach(() => {
  state.tables = new Map();
  state.updates = [];
  vi.clearAllMocks();
});

describe("regenerateLeadCore — Intro-Staging-Routing", () => {
  it("scope=video + Intro aktiv: nullt Intro-Snapshot, Run→generating, Staging-Queue statt Direkt-Enqueue (Kristina-Incident)", async () => {
    setCampaign(true);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateLeadCore(LEAD_INPUT, "video");

    expect(res.status).toBe(200);
    const [patch] = leadUpdatePatches();
    expect(patch.introStatus).toBeNull();
    expect(patch.introResult).toBeNull();
    expect(patch.videoUrl).toBeNull();
    expect(updateRun).toHaveBeenCalledWith(
      "run-1",
      "user-1",
      expect.objectContaining({ status: "generating", completedAt: null }),
    );
    expect(enqueueLeadsForIntroStaging).toHaveBeenCalledWith(
      ["lead-1"],
      "run-1",
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("scope=all + Intro aktiv: ebenfalls Staging-Queue", async () => {
    setCampaign(true);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateLeadCore(LEAD_INPUT, "all");

    expect(res.status).toBe(200);
    expect(enqueueLeadsForIntroStaging).toHaveBeenCalledWith(
      ["lead-1"],
      "run-1",
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("scope=video + Intro deaktiviert: Direkt-Enqueue in die lead-pipeline", async () => {
    setCampaign(false);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateLeadCore(LEAD_INPUT, "video");

    expect(res.status).toBe(200);
    expect(enqueueLeadsForIntroStaging).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      "lead-pipeline",
      expect.objectContaining({ leadId: "lead-1", skipPdf: true }),
      expect.anything(),
    );
  });

  it("scope=pdf (kein Video): Intro-Snapshot bleibt unangetastet, Direkt-Enqueue", async () => {
    setCampaign(true);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateLeadCore(LEAD_INPUT, "pdf");

    expect(res.status).toBe(200);
    const [patch] = leadUpdatePatches();
    expect("introStatus" in patch).toBe(false);
    expect("introResult" in patch).toBe(false);
    expect(enqueueLeadsForIntroStaging).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      "lead-pipeline",
      expect.objectContaining({ skipVideo: true }),
      expect.anything(),
    );
  });

  it("laufende Runde: 409, nichts enqueued", async () => {
    setCampaign(true);
    const res = await regenerateLeadCore(
      { ...LEAD_INPUT, runStatus: "generating" },
      "video",
    );
    expect(res.status).toBe(409);
    expect(enqueueLeadsForIntroStaging).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe("regenerateRunCore — Intro-Staging-Routing", () => {
  it("mode=video + Intro aktiv: nullt Intro-Snapshot aller Leads, Staging-Queue statt addBulk", async () => {
    setCampaign(true);
    setLeads([{ id: "lead-1" }, { id: "lead-2" }]);

    const res = await regenerateRunCore(RUN, "video");

    expect(res.status).toBe(200);
    const patch = leadUpdatePatches().at(-1)!;
    expect(patch.introStatus).toBeNull();
    expect(patch.introResult).toBeNull();
    expect(enqueueLeadsForIntroStaging).toHaveBeenCalledWith(
      ["lead-1", "lead-2"],
      "run-1",
    );
    expect(queueAddBulk).not.toHaveBeenCalled();
  });

  it("mode=failed + Intro aktiv: nur failed Leads, inkl. Intro-Reset, über Staging", async () => {
    setCampaign(true);
    setLeads([
      { id: "lead-1", status: "completed" },
      { id: "lead-2", status: "failed" },
    ]);

    const res = await regenerateRunCore(RUN, "failed");

    expect(res.status).toBe(200);
    const patch = leadUpdatePatches().at(-1)!;
    expect(patch.introStatus).toBeNull();
    expect(patch.introResult).toBeNull();
    expect(enqueueLeadsForIntroStaging).toHaveBeenCalledWith(
      ["lead-2"],
      "run-1",
    );
    expect(queueAddBulk).not.toHaveBeenCalled();
  });

  it("mode=video + Intro deaktiviert: addBulk direkt in die lead-pipeline", async () => {
    setCampaign(false);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateRunCore(RUN, "video");

    expect(res.status).toBe(200);
    expect(enqueueLeadsForIntroStaging).not.toHaveBeenCalled();
    expect(queueAddBulk).toHaveBeenCalled();
  });

  it("mode=pdf (kein Video): Intro-Snapshot bleibt, addBulk mit skipVideo", async () => {
    setCampaign(true);
    setLeads([{ id: "lead-1" }]);

    const res = await regenerateRunCore(RUN, "pdf");

    expect(res.status).toBe(200);
    const patch = leadUpdatePatches().at(-1)!;
    expect("introStatus" in patch).toBe(false);
    expect(enqueueLeadsForIntroStaging).not.toHaveBeenCalled();
    expect(queueAddBulk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ skipVideo: true }),
        }),
      ]),
    );
  });
});
