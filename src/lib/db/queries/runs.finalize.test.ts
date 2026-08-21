/**
 * finalizeRunIfAllLeadsDone — Run-Completeness-Gate + Auto-Retry.
 *
 * `@/lib/db` wird durch ein sequenzielles Mock ersetzt (execute-Queue +
 * select-Queue + update-Result-Queue), damit die Reihenfolge der
 * Statements testbar ist:
 *   1. execute: total/done
 *   2. select:  Run-Row (status/userId/campaignId/envelope/ab/introExpected)
 *   3. select:  Campaign-Row (introEnabled/envelopeTemplateId)
 *   4. update:  Gate (completed ohne Pflicht-Bestandteil → failed)
 *   5. execute: retryable failed Leads (NOT EXISTS autoretry-Event)
 *   6. update:  Lead → pending (pro Retry) + queue.add
 *   7. execute: tally completed/failed
 *   8. update:  Run → completed (mit Status-Guard)
 *
 * Die WHERE-Klauseln der Updates werden als Text-Flattening der Drizzle-
 * SQL-Chunks mitgeschnitten, damit die config-abhängigen Gate-Bedingungen
 * (intro_status / envelope_pdf_url / ab_variant, seit 2026-08-21)
 * pro Konfiguration exakt geprüft werden können.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  executeResults: [] as unknown[],
  updateResults: [] as unknown[],
  updateCalls: [] as Array<{ patch: Record<string, unknown>; whereText: string }>,
  insertCalls: [] as Array<Record<string, unknown>>,
  insertShouldFail: false,
  selectResults: [] as unknown[][],
}));

/**
 * Flacht ein Drizzle-SQL-Objekt (queryChunks aus StringChunks, Columns,
 * verschachtelten SQLs) zu einem groben Text ab — reicht, um zu prüfen,
 * WELCHE Spalten in einer WHERE-Klausel vorkommen.
 */
const sqlToText = vi.hoisted(() => {
  const fn = (node: unknown): string => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(fn).join("");
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.queryChunks)) return fn(o.queryChunks);
    if (Array.isArray(o.value)) return (o.value as unknown[]).join("");
    if (typeof o.name === "string") return ` ${o.name} `;
    return "";
  };
  return fn;
});

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(() => {
      const next = state.executeResults.shift() ?? [];
      return Promise.resolve(next);
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.selectResults.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (state.insertShouldFail) {
          return Promise.reject(new Error("insert failed"));
        }
        state.insertCalls.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          state.updateCalls.push({ patch, whereText: sqlToText(cond) });
          const result = state.updateResults.shift() ?? [];
          const p = Promise.resolve(result) as Promise<unknown> & {
            returning: () => Promise<unknown>;
          };
          p.returning = () => Promise.resolve(result);
          return p;
        },
      }),
    }),
  },
}));

const webhookMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhooks/lead-event-hook", () => ({
  enqueueWebhooksForRunFinalized: webhookMock,
}));

const notifyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/run-notifications", () => ({
  sendRunCompletionNotification: notifyMock,
}));

const eventMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/db/queries/pipeline-events", () => ({
  insertPipelineEvent: eventMock,
}));

const opsAlertMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/ops-alert", () => ({ sendOpsAlert: opsAlertMock }));

const queueAddMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => undefined),
);
const queueRemoveMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => undefined),
);
vi.mock("@/worker/queue", () => ({
  pipelineQueue: () => ({ add: queueAddMock, remove: queueRemoveMock }),
}));

import { finalizeRunIfAllLeadsDone } from "./runs";

const RUN_ID = "run-1";

/** Run-Row im Status generating; Config-Felder per Override. */
function generatingRun(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "generating",
    userId: "user-1",
    campaignId: "camp-1",
    envelopeTemplateId: null,
    abConfig: null,
    introExpected: null,
    ...overrides,
  };
}

function baseCampaign(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { introEnabled: false, envelopeTemplateId: null, ...overrides };
}

/** WHERE-Text des Gate-Flips (erstes Update auf leads.status=failed). */
function gateWhereText(): string {
  const call = state.updateCalls.find(
    (c) =>
      c.patch.status === "failed" &&
      typeof c.patch.errorMessage === "string" &&
      c.patch.errorMessage.includes("Pflicht-Bestandteil"),
  );
  return call?.whereText ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  state.executeResults = [];
  state.updateResults = [];
  state.updateCalls = [];
  state.insertCalls = [];
  state.insertShouldFail = false;
  state.selectResults = [];
});

describe("finalizeRunIfAllLeadsDone", () => {
  it("nicht alle Leads terminal → kein Finalize, kein Retry", async () => {
    state.executeResults = [[{ total: 5, done: 3 }]];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res).toEqual({ finalized: false, total: 5, done: 3 });
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("failed Lead ohne Retry-Marker → 1× Auto-Retry statt Finalize", async () => {
    state.executeResults = [
      [{ total: 3, done: 3 }],
      [{ id: "lead-1", row_index: 4 }], // retryable
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [
      [], // Gate: nichts zu kippen
      [], // lead-1 → pending
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(false);
    expect(res.done).toBe(2);
    // Stale-Job wird gepurged, dann mit jobId=leadId (wie alle Recovery-
    // Pfade) + Fairness-Priorität neu geadded
    expect(queueRemoveMock).toHaveBeenCalledWith("lead-1");
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock.mock.calls[0][2]).toMatchObject({
      jobId: "lead-1",
      priority: 5,
    });
    expect(queueAddMock.mock.calls[0][1]).toMatchObject({
      leadId: "lead-1",
      runId: RUN_ID,
      userId: "user-1",
      campaignId: "camp-1",
    });
    // Lead wurde vor dem Enqueue auf pending gesetzt
    expect(
      state.updateCalls.some((c) => c.patch.status === "pending"),
    ).toBe(true);
    // Autoretry-Marker DIREKT (werfend) in pipeline_events geschrieben
    expect(
      state.insertCalls.some(
        (v) => v.stage === "autoretry" && v.leadId === "lead-1",
      ),
    ).toBe(true);
    // Run wurde NICHT finalisiert
    expect(webhookMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("Marker-Insert schlägt fehl → KEIN Enqueue, Lead bleibt failed, Run finalisiert", async () => {
    state.insertShouldFail = true;
    state.executeResults = [
      [{ total: 2, done: 2 }],
      [{ id: "lead-1", row_index: 0 }], // retryable
      [{ completed: 1, failed: 1 }],
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [
      [], // Gate
      [], // lead-1 → zurück auf failed (catch-Pfad)
      [{ id: RUN_ID }], // Run → completed
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(queueAddMock).not.toHaveBeenCalled();
    expect(res.finalized).toBe(true);
  });

  it("failed Lead MIT Retry-Marker → Finalize mit Fehlschlägen + Ops-Alert", async () => {
    state.executeResults = [
      [{ total: 3, done: 3 }],
      [], // keine retryable Leads mehr
      [{ completed: 2, failed: 1 }],
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [
      [], // Gate
      [{ id: RUN_ID }], // Run → completed
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(true);
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(webhookMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(opsAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ topic: `run-failures-${RUN_ID}` }),
    );
  });

  it("Finalize ohne Fehlschläge → kein Ops-Alert", async () => {
    state.executeResults = [
      [{ total: 2, done: 2 }],
      [], // keine retryable Leads
      [{ completed: 2, failed: 0 }],
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [[], [{ id: RUN_ID }]];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(true);
    expect(opsAlertMock).not.toHaveBeenCalled();
  });

  it("Gate kippt completed-Lead ohne Video auf failed + Event", async () => {
    state.executeResults = [
      [{ total: 2, done: 2 }],
      [{ id: "lead-broken", row_index: 0 }], // frisch gekippter Lead ist retryable
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [
      [{ id: "lead-broken" }], // Gate-Flip
      [], // lead-broken → pending
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(false);
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: "lead-broken",
        level: "error",
        message: expect.stringContaining("Completeness-Gate"),
      }),
    );
    // und danach Auto-Retry für genau diesen Lead
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it("Run bereits terminal → weder Gate noch Retry, kein Webhook", async () => {
    state.executeResults = [
      [{ total: 3, done: 3 }],
      [{ completed: 2, failed: 1 }],
    ];
    state.selectResults = [
      [
        {
          status: "completed",
          userId: "user-1",
          campaignId: "camp-1",
          envelopeTemplateId: null,
          abConfig: null,
          introExpected: null,
        },
      ],
    ];
    state.updateResults = [[]]; // Run-UPDATE greift nicht (Status-Guard)

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(false);
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(webhookMock).not.toHaveBeenCalled();
  });

  it("Enqueue schlägt fehl (Redis down) → Lead zurück auf failed, Run finalisiert", async () => {
    queueAddMock.mockRejectedValueOnce(new Error("redis down"));
    state.executeResults = [
      [{ total: 2, done: 2 }],
      [{ id: "lead-1", row_index: 0 }], // retryable
      [{ completed: 1, failed: 1 }],
    ];
    state.selectResults = [[generatingRun()], [baseCampaign()]];
    state.updateResults = [
      [], // Gate
      [], // lead-1 → pending
      [], // lead-1 → zurück auf failed
      [{ id: RUN_ID }], // Run → completed
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(true);
    const failedRestore = state.updateCalls.filter(
      (c) => c.patch.status === "failed",
    );
    expect(failedRestore.length).toBeGreaterThan(0);
    expect(opsAlertMock).toHaveBeenCalled();
  });
});

describe("finalizeRunIfAllLeadsDone — config-aware Gate (2026-08-21)", () => {
  /** Führt einen Finalize ohne Flips/Retries aus, damit nur die
   *  Gate-WHERE-Klausel interessiert. */
  async function runFinalize(input: {
    run: Record<string, unknown>;
    campaign?: Record<string, unknown>;
  }) {
    state.executeResults = [
      [{ total: 1, done: 1 }],
      [], // keine retryable Leads
      [{ completed: 1, failed: 0 }],
    ];
    state.selectResults = input.campaign
      ? [[input.run], [input.campaign]]
      : [[input.run]];
    state.updateResults = [[], [{ id: RUN_ID }]];
    return finalizeRunIfAllLeadsDone(RUN_ID);
  }

  it("Basis-Gate prüft immer Video + Slug", async () => {
    await runFinalize({ run: generatingRun(), campaign: baseCampaign() });
    const where = gateWhereText();
    expect(where).toContain("video_url");
    expect(where).toContain("slug");
    expect(where).not.toContain("intro_status");
    expect(where).not.toContain("envelope_pdf_url");
    expect(where).not.toContain("ab_variant");
  });

  it("Regression 2026-08-21: introExpected=true + introEnabled → Gate verlangt intro_status", async () => {
    // Der Produktions-Bug: introStatus='disabled' rutschte als completed
    // durch. Mit introExpected=true MUSS die WHERE-Klausel den
    // introStatus prüfen (NOT IN generated/fallback_name).
    await runFinalize({
      run: generatingRun({ introExpected: true }),
      campaign: baseCampaign({ introEnabled: true }),
    });
    const where = gateWhereText();
    expect(where).toContain("intro_status");
    expect(where).toContain("'generated', 'fallback_name'");
  });

  it("introExpected=false (User startete bewusst ohne Begrüßung) → keine intro-Bedingung", async () => {
    await runFinalize({
      run: generatingRun({ introExpected: false }),
      campaign: baseCampaign({ introEnabled: true }),
    });
    expect(gateWhereText()).not.toContain("intro_status");
  });

  it("introExpected=NULL (Legacy-Run vor Migration 0064) → keine intro-Bedingung", async () => {
    await runFinalize({
      run: generatingRun({ introExpected: null }),
      campaign: baseCampaign({ introEnabled: true }),
    });
    expect(gateWhereText()).not.toContain("intro_status");
  });

  it("introExpected=true, aber Feature inzwischen deaktiviert → keine intro-Bedingung (Live-Check)", async () => {
    await runFinalize({
      run: generatingRun({ introExpected: true }),
      campaign: baseCampaign({ introEnabled: false }),
    });
    expect(gateWhereText()).not.toContain("intro_status");
  });

  it("Umschlag-Template auf dem Run → Gate verlangt envelope_pdf_url", async () => {
    await runFinalize({
      run: generatingRun({ envelopeTemplateId: "tpl-1" }),
      campaign: baseCampaign(),
    });
    expect(gateWhereText()).toContain("envelope_pdf_url");
  });

  it("Umschlag-Template auf der Kampagne (ohne Run-Override) → Gate verlangt envelope_pdf_url", async () => {
    await runFinalize({
      run: generatingRun(),
      campaign: baseCampaign({ envelopeTemplateId: "tpl-1" }),
    });
    expect(gateWhereText()).toContain("envelope_pdf_url");
  });

  it("abConfig-Snapshot vorhanden → Gate verlangt ab_variant", async () => {
    await runFinalize({
      run: generatingRun({
        abConfig: { mode: "random", weightA: 50, urlA: "a", urlB: "b" },
      }),
      campaign: baseCampaign(),
    });
    const where = gateWhereText();
    expect(where).toContain("ab_variant");
    expect(where).toContain("'A', 'B'");
  });

  it("volle Konfiguration → alle drei Zusatz-Bedingungen aktiv", async () => {
    await runFinalize({
      run: generatingRun({
        introExpected: true,
        envelopeTemplateId: "tpl-1",
        abConfig: { mode: "sequential", weightA: 30, urlA: "a", urlB: "b" },
      }),
      campaign: baseCampaign({ introEnabled: true }),
    });
    const where = gateWhereText();
    expect(where).toContain("intro_status");
    expect(where).toContain("envelope_pdf_url");
    expect(where).toContain("ab_variant");
  });

  it("Gate-Flip wegen fehlender Begrüßung → failed + Auto-Retry (End-to-End des Incident-Fixes)", async () => {
    state.executeResults = [
      [{ total: 1, done: 1 }],
      [{ id: "lead-intro", row_index: 0 }], // frisch gekippter Lead ist retryable
    ];
    state.selectResults = [
      [generatingRun({ introExpected: true })],
      [baseCampaign({ introEnabled: true })],
    ];
    state.updateResults = [
      [{ id: "lead-intro" }], // Gate-Flip
      [], // lead-intro → pending
    ];

    const res = await finalizeRunIfAllLeadsDone(RUN_ID);

    expect(res.finalized).toBe(false);
    expect(gateWhereText()).toContain("intro_status");
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: "lead-intro",
        level: "error",
        message: expect.stringContaining("Completeness-Gate"),
      }),
    );
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(webhookMock).not.toHaveBeenCalled();
  });
});
