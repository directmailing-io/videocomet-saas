/**
 * Anrede-Dedup (W4) — Claim-Zustandsautomat.
 *
 * Strategie wie in cleanup-race.test.ts: `@/lib/db` wird durch einen
 * In-Memory-Store ersetzt, der die SQL-Semantik der vier Operationen
 * nachbildet (INSERT ON CONFLICT, SELECT, UPDATE mit pending/stale-Guard
 * bzw. ready-Set, DELETE). `fetch` (HEAD-Verifikation der Bunny-URL) wird
 * pro Test gestubbt.
 *
 * Abgedeckt:
 *   - computeIntroCacheKey: deterministisch, jede Komponente schlägt durch
 *   - Erst-Claim → generate (pending-Row entsteht)
 *   - Zweit-Claim bei frischem pending → wait
 *   - ready + HEAD ok → hit mit Ergebnis
 *   - ready + HEAD 404 → Eintrag verworfen, Re-Claim → generate
 *   - pending älter als Stale-Schwelle → Übernahme (generate)
 *   - releaseIntroCacheClaim → nächster Claim generiert wieder
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockRow {
  id: string;
  userId: string;
  cacheKey: string;
  status: "pending" | "ready";
  result: Record<string, unknown> | null;
  updatedAt: Date;
}

const state = vi.hoisted(() => ({ rows: [] as MockRow[], nextId: 1 }));

const PENDING_STALE_MS = 12 * 60 * 1000;

vi.mock("@/lib/db", () => {
  function applyUpdate(patch: Record<string, unknown>): MockRow[] {
    const staleBefore = Date.now() - PENDING_STALE_MS;
    // markIntroCacheReady setzt status='ready'; die Takeover-Variante setzt
    // nur updatedAt und greift per SQL-Guard nur auf stale-pending Rows.
    const matched =
      patch.status === "ready"
        ? [...state.rows]
        : state.rows.filter(
            (r) => r.status === "pending" && r.updatedAt.getTime() < staleBefore,
          );
    for (const r of matched) {
      if (patch.status === "ready") {
        r.status = "ready";
        r.result = (patch.result as Record<string, unknown>) ?? null;
      }
      r.updatedAt = new Date();
    }
    return matched;
  }

  return {
    db: {
      insert: () => ({
        values: (v: { userId: string; cacheKey: string; status?: string }) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              const exists = state.rows.some(
                (r) => r.userId === v.userId && r.cacheKey === v.cacheKey,
              );
              if (exists) return Promise.resolve([]);
              const row: MockRow = {
                id: `row-${state.nextId++}`,
                userId: v.userId,
                cacheKey: v.cacheKey,
                status: (v.status as MockRow["status"]) ?? "pending",
                result: null,
                updatedAt: new Date(),
              };
              state.rows.push(row);
              return Promise.resolve([{ id: row.id }]);
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([...state.rows]),
          }),
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            const matched = applyUpdate(patch);
            const thenable = {
              returning: () => Promise.resolve(matched.map((r) => ({ id: r.id }))),
              then: (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown,
              ) => Promise.resolve(undefined).then(resolve, reject),
            };
            return thenable;
          },
        }),
      }),
      delete: () => ({
        where: () => {
          // Tests halten maximal EINE Row — beide echten DELETE-Pfade
          // (release: pending-Guard, hit-404: per id) treffen genau diese.
          state.rows.length = 0;
          return Promise.resolve([]);
        },
      }),
    },
  };
});

import {
  claimIntroCache,
  computeIntroCacheKey,
  markIntroCacheReady,
  releaseIntroCacheClaim,
} from "./intro-dedup";

const KEY_OPTS = {
  ttsText: "Hi Daniel!",
  fishModelId: "fish-1",
  webcamMediaId: "media-1",
  calibrationUpdatedAt: new Date("2026-08-01T10:00:00Z"),
};

const RESULT = {
  url: "https://cdn.example/intro.mp4",
  startTrimMs: 1200,
  firstName: "Daniel",
  generatedAt: "2026-08-08T12:00:00.000Z",
};

function stubHead(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok })),
  );
}

beforeEach(() => {
  state.rows.length = 0;
  state.nextId = 1;
  stubHead(true);
});

describe("computeIntroCacheKey", () => {
  it("ist deterministisch für identische Inputs", () => {
    expect(computeIntroCacheKey(KEY_OPTS)).toBe(computeIntroCacheKey({ ...KEY_OPTS }));
  });

  it.each([
    ["ttsText", { ttsText: "Hi Julia!" }],
    ["fishModelId", { fishModelId: "fish-2" }],
    ["webcamMediaId", { webcamMediaId: "media-2" }],
    [
      "calibrationUpdatedAt",
      { calibrationUpdatedAt: new Date("2026-08-02T10:00:00Z") },
    ],
  ] as const)("ändert sich bei anderem %s", (_label, patch) => {
    expect(computeIntroCacheKey({ ...KEY_OPTS, ...patch })).not.toBe(
      computeIntroCacheKey(KEY_OPTS),
    );
  });
});

describe("claimIntroCache", () => {
  it("erster Claim → generate und legt pending-Row an", async () => {
    const claim = await claimIntroCache("user-1", "key-1");
    expect(claim.role).toBe("generate");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].status).toBe("pending");
  });

  it("zweiter Claim bei frischem pending → wait", async () => {
    await claimIntroCache("user-1", "key-1");
    const second = await claimIntroCache("user-1", "key-1");
    expect(second.role).toBe("wait");
  });

  it("ready + erreichbare URL → hit mit Ergebnis", async () => {
    await claimIntroCache("user-1", "key-1");
    await markIntroCacheReady("user-1", "key-1", RESULT);
    const claim = await claimIntroCache("user-1", "key-1");
    expect(claim).toEqual({ role: "hit", result: RESULT });
  });

  it("ready + gelöschtes Asset (HEAD !ok) → Eintrag verworfen, generate", async () => {
    await claimIntroCache("user-1", "key-1");
    await markIntroCacheReady("user-1", "key-1", RESULT);
    stubHead(false);
    const claim = await claimIntroCache("user-1", "key-1");
    expect(claim.role).toBe("generate");
    // Der verworfene ready-Eintrag wurde durch einen frischen pending ersetzt.
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].status).toBe("pending");
  });

  it("pending älter als Stale-Schwelle → Übernahme (generate)", async () => {
    await claimIntroCache("user-1", "key-1");
    state.rows[0].updatedAt = new Date(Date.now() - PENDING_STALE_MS - 60_000);
    const claim = await claimIntroCache("user-1", "key-1");
    expect(claim.role).toBe("generate");
    // Übernahme re-ankert updatedAt — der nächste Konkurrent wartet wieder.
    const next = await claimIntroCache("user-1", "key-1");
    expect(next.role).toBe("wait");
  });

  it("nach releaseIntroCacheClaim → nächster Claim generiert wieder", async () => {
    await claimIntroCache("user-1", "key-1");
    await releaseIntroCacheClaim("user-1", "key-1");
    expect(state.rows).toHaveLength(0);
    const claim = await claimIntroCache("user-1", "key-1");
    expect(claim.role).toBe("generate");
  });
});
