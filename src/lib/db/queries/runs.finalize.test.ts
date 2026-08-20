/**
 * finalizeRunIfAllLeadsDone — Run-Completeness-Gate + Auto-Retry.
 *
 * `@/lib/db` wird durch ein sequenzielles Mock ersetzt (execute-Queue +
 * update-Result-Queue), damit die Reihenfolge der Statements testbar ist:
 *   1. execute: total/done
 *   2. select:  Run-Row (status/userId/campaignId)
 *   3. update:  Gate (completed ohne Video/Slug → failed)
 *   4. execute: retryable failed Leads (NOT EXISTS autoretry-Event)
 *   5. update:  Lead → pending (pro Retry) + queue.add
 *   6. execute: tally completed/failed
 *   7. update:  Run → completed (mit Status-Guard)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  executeResults: [] as unknown[],
  updateResults: [] as unknown[],
  updateCalls: [] as Array<{ patch: Record<string, unknown> }>,
  insertCalls: [] as Array<Record<string, unknown>>,
  insertShouldFail: false,
  selectResult: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(() => {
      const next = state.executeResults.shift() ?? [];
      return Promise.resolve(next);
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.selectResult),
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
        where: () => {
          state.updateCalls.push({ patch });
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
const generatingRun = [
  { status: "generating", userId: "user-1", campaignId: "camp-1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.executeResults = [];
  state.updateResults = [];
  state.updateCalls = [];
  state.insertCalls = [];
  state.insertShouldFail = false;
  state.selectResult = [];
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
    state.selectResult = generatingRun;
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
    state.selectResult = generatingRun;
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
    state.selectResult = generatingRun;
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
    state.selectResult = generatingRun;
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
    state.selectResult = generatingRun;
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
    state.selectResult = [
      { status: "completed", userId: "user-1", campaignId: "camp-1" },
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
    state.selectResult = generatingRun;
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
