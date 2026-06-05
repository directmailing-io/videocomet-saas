/**
 * Cleanup-Race-Regression-Test (Paket G Bug 2).
 *
 * Szenario:
 *   1. Asset A ist in `purge_state='purge_pending'`, hat 0 Refs.
 *   2. Der Purge-Worker hat den Asset bereits aus `getAssetsReadyForPurge`
 *      gelesen und wäre kurz davor, `deleteVideo(bunnyId)` aufzurufen.
 *   3. ZWISCHENZEITLICH erzeugt ein paralleler Worker eine neue Ref auf
 *      genau dieselbe Bunny-GUID (z.B. zweiter Lead mit gleichem source-hash
 *      → `trackBunnyAsset` returnt denselben Asset-Row, `addBunnyAssetRef`
 *      hängt eine Ref dran).
 *   4. Der Worker DARF jetzt NICHT mehr Bunny-DELETEn, weil sonst der neue
 *      Ref-Owner einen 404 sehen würde.
 *
 * Vor dem Fix: `purgeSingleAsset` rief direkt `deleteVideo` → physisch weg.
 * Nach dem Fix: `claimAssetForPhysicalDelete` checkt nochmal Refs==0 ∧
 * State='purge_pending'. Bei Race → `skipped`, kein Bunny-Call.
 *
 * Strategie:
 *   - Wir mocken `@/lib/db` mit einem in-memory Snapshot von
 *     `bunny_assets` + `bunny_asset_refs`. `db.transaction` läuft synchron
 *     gegen denselben Snapshot.
 *   - Wir spy'en `deleteVideo` / `deleteFile` aus dem Bunny-SDK.
 *   - Test 1: kein Race → Bunny-DELETE wird aufgerufen, Asset wird
 *     `purged`.
 *   - Test 2: zwischen `claim` und `purge` taucht eine Ref auf → DELETE
 *     wird NICHT aufgerufen (skip-Path).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface AssetRow {
  id: string;
  kind: "stream" | "storage";
  bunnyId: string;
  purgeState: "live" | "purge_pending" | "purged";
  purgeAttempts: number;
  purgeLastError: string | null;
  purgedAt: Date | null;
}

interface RefRow {
  assetId: string;
}

const assets: AssetRow[] = [];
const refs: RefRow[] = [];

function reset(): void {
  assets.length = 0;
  refs.length = 0;
}

// ── DB-Stub ────────────────────────────────────────────────────────────────
//
// Wir implementieren genau die zwei Drizzle-Pfade, die `bunny-purge.ts`
// nach dem Fix benutzt:
//   - `db.transaction(cb)` mit innerem `tx.select().from().where().limit()`
//   - `db.update().set().where()` (für `markAssetPurged` / `markAssetPurgeFailed`)
//   - `db.select().from().where().limit()` (für `logStaleAssets`)
//
// Routing erfolgt nicht über Table-Identity (wir haben kein echtes Schema),
// sondern wir routen pauschal alle `select`-Calls auf `bunny_assets`.
// Refs werden über einen eigenen Helper-Hook injiziert.

let inflightRaceHook: (() => void) | null = null;

function selectFromAssets(filterRefsZero: boolean): AssetRow[] {
  // Spiegelt die Race-Defensive-Query:
  //   SELECT id FROM bunny_assets WHERE id=$1 AND purge_state='purge_pending'
  //     AND NOT EXISTS (SELECT 1 FROM bunny_asset_refs WHERE asset_id=$1)
  // Wir filtern hier am Snapshot.
  return assets.filter((a) => {
    if (a.purgeState !== "purge_pending") return false;
    if (filterRefsZero) {
      if (refs.some((r) => r.assetId === a.id)) return false;
    }
    return true;
  });
}

vi.mock("@/lib/db", () => {
  const txApi = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            // Race-Hook: hier injizieren wir die parallele Ref-Erzeugung.
            const hook = inflightRaceHook;
            inflightRaceHook = null;
            if (hook) hook();
            return Promise.resolve(selectFromAssets(true));
          },
        }),
      }),
    }),
  };

  return {
    db: {
      transaction: async (cb: (tx: typeof txApi) => Promise<unknown>) =>
        cb(txApi),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: (patch: Partial<AssetRow>) => ({
          where: () => {
            // Wir können hier nicht mehr unterscheiden, welche Asset-ID
            // gemeint war (Drizzle-Builder ist abstrahiert). Für die Tests
            // wenden wir den Patch pauschal auf den ersten `purge_pending`-
            // Row an — das reicht, weil pro Test nur EIN Asset existiert.
            const target = assets.find((a) => a.purgeState === "purge_pending");
            if (target) Object.assign(target, patch);
            return Promise.resolve();
          },
        }),
      }),
      execute: () => Promise.resolve({ count: 0 }),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  bunnyAssets: {
    id: "id",
    kind: "kind",
    bunnyId: "bunnyId",
    purgeState: "purgeState",
    purgeAttempts: "purgeAttempts",
    createdAt: "createdAt",
    purgeLastError: "purgeLastError",
  },
  bunnyAssetRefs: { assetId: "assetId" },
}));

// Bunny-SDK-Stubs.
const deleteVideoSpy = vi.fn().mockResolvedValue(undefined);
const deleteFileSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/bunny/stream", () => ({
  deleteVideo: (id: string) => deleteVideoSpy(id),
}));
vi.mock("@/lib/bunny/storage", () => ({
  deleteFile: (id: string) => deleteFileSpy(id),
}));
vi.mock("@/lib/bunny/_fetch", () => ({
  BunnyApiError: class extends Error {
    status: number;
    constructor(status: number, msg: string) {
      super(msg);
      this.status = status;
    }
  },
}));

// Queries: wir importieren die ECHTEN bunny-asset-Queries, damit der State-
// Übergang `markAssetPurged` über unseren `db.update`-Stub läuft.
import {
  markAssetPurgeFailed,
  markAssetPurged,
} from "@/lib/db/queries/bunny-assets";

// Wir testen die intern verwendete `purgeSingleAsset`-Logik nicht direkt
// (privat); stattdessen rufen wir `runBunnyPurgeTick`. Damit der Tick aber
// nicht erst orphans sweepen will, mocken wir den Queries-Sweep.
vi.mock("@/lib/db/queries/bunny-assets", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/queries/bunny-assets")>();
  return {
    ...actual,
    markOrphanedAssetsForPurge: vi.fn().mockResolvedValue(0),
    getAssetsReadyForPurge: vi.fn(async () =>
      assets
        .filter((a) => a.purgeState === "purge_pending")
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          bunnyId: a.bunnyId,
          userId: "user-1",
          purgeAttempts: a.purgeAttempts,
        })),
    ),
    markAssetPurged: vi.fn(async (id: string) => {
      const t = assets.find((a) => a.id === id);
      if (t) {
        t.purgeState = "purged";
        t.purgedAt = new Date();
        t.purgeLastError = null;
      }
    }),
    markAssetPurgeFailed: vi.fn(async (id: string, err: string) => {
      const t = assets.find((a) => a.id === id);
      if (t) {
        t.purgeAttempts += 1;
        t.purgeLastError = err;
      }
    }),
  };
});

import { runBunnyPurgeTick } from "@/worker/processors/bunny-purge";

beforeEach(() => {
  reset();
  deleteVideoSpy.mockClear();
  deleteFileSpy.mockClear();
  inflightRaceHook = null;
});

describe("cleanup-race (Paket G Bug 2)", () => {
  it("Test 1: keine Race → Bunny-DELETE wird ausgeführt, Asset wird purged", async () => {
    assets.push({
      id: "asset-A",
      kind: "stream",
      bunnyId: "guid-A",
      purgeState: "purge_pending",
      purgeAttempts: 0,
      purgeLastError: null,
      purgedAt: null,
    });

    const result = await runBunnyPurgeTick();

    expect(deleteVideoSpy).toHaveBeenCalledTimes(1);
    expect(deleteVideoSpy).toHaveBeenCalledWith("guid-A");
    expect(result.purged).toBe(1);
    expect(result.skippedRace).toBe(0);
    expect(assets[0].purgeState).toBe("purged");
  });

  it("Test 2: Race-Defensive — eine neue Ref taucht im Claim-Fenster auf → kein Bunny-DELETE, Asset bleibt purge_pending", async () => {
    assets.push({
      id: "asset-B",
      kind: "stream",
      bunnyId: "guid-B",
      purgeState: "purge_pending",
      purgeAttempts: 0,
      purgeLastError: null,
      purgedAt: null,
    });

    // Race-Sim: GENAU wenn `claimAssetForPhysicalDelete` seine SELECT-Query
    // ausführt, hängen wir parallel eine neue Ref dran. Im echten System
    // entspricht das einem zweiten Worker, der `addBunnyAssetRef` zwischen
    // Orphan-Sweep und Bunny-DELETE schreibt.
    inflightRaceHook = () => {
      refs.push({ assetId: "asset-B" });
    };

    const result = await runBunnyPurgeTick();

    // KRITISCH: kein Bunny-Call.
    expect(deleteVideoSpy).not.toHaveBeenCalled();
    expect(deleteFileSpy).not.toHaveBeenCalled();
    expect(result.skippedRace).toBe(1);
    expect(result.purged).toBe(0);
    // Asset bleibt im `purge_pending`-Zustand → der nächste Sweep wird ihn
    // erst dann erneut anfassen, wenn die Refs wieder weg sind.
    expect(assets[0].purgeState).toBe("purge_pending");
    expect(refs).toHaveLength(1);
  });

  it("Smoke: markAssetPurged / markAssetPurgeFailed (Stub-Sanity)", async () => {
    assets.push({
      id: "asset-C",
      kind: "storage",
      bunnyId: "/path/to/file.mp4",
      purgeState: "purge_pending",
      purgeAttempts: 0,
      purgeLastError: null,
      purgedAt: null,
    });
    await markAssetPurged("asset-C");
    expect(assets[0].purgeState).toBe("purged");
    await markAssetPurgeFailed("asset-C", "boom");
    expect(assets[0].purgeAttempts).toBe(1);
    expect(assets[0].purgeLastError).toBe("boom");
  });
});
