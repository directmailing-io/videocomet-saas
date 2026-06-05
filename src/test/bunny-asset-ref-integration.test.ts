/**
 * Bunny-Asset-Ref-Integration-Tests (Paket D Regression-Guard).
 *
 * Hintergrund:
 *   `trackBunnyAsset` returnt `{ assetId, created }`. In Paket D's
 *   ursprünglichem Pipeline-Code wurde fälschlich `asset.id` gelesen →
 *   `addBunnyAssetRef(undefined, ownerType, ownerId)` → Ref wurde nie
 *   geschrieben → Purge-Sweep markierte das frische Asset als orphan →
 *   physisch gelöscht innerhalb 60 s → Lead bekam 404 auf die Video-URL.
 *
 *   Dieser Test-Block lockt das Pattern: Helper `trackAndRefAsset` MUSS
 *   nach Tracking eine Row in `bunny_asset_refs` ablegen, idempotent sein
 *   und auf Owner-Cleanup wieder verschwinden.
 *
 * Strategie:
 *   - DB-Layer (`@/lib/db`) wird via `vi.mock` durch eine In-Memory-Map
 *     ersetzt. Wir simulieren die UNIQUE-Constraint-Semantik der echten
 *     Postgres-Indizes auf (asset_id, owner_type, owner_id).
 *   - Die echten Query-Funktionen aus `@/lib/db/queries/bunny-assets`
 *     werden ausgeführt; nur das DB-Backend wird gestubbed.
 *
 * Wenn das Repo später eine echte Test-DB bekommt (Drizzle-Schema-Push
 * vor Test-Run), kann dieser File ohne API-Änderung auf
 * `db.execute(sql\`TRUNCATE …\`)` umgestellt werden.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-Memory DB-Stub ────────────────────────────────────────────────────
//
// Wir mocken `@/lib/db` (das die `db`-Drizzle-Instanz exportiert) BEVOR
// `@/lib/db/queries/bunny-assets` importiert wird. Der Helper unter Test
// nutzt die echten Query-Funktionen.
//
// Implementation: minimaler Drizzle-Stub. Wir fangen `.insert(table)…
// .onConflictDoNothing(…).returning(…)` und `.delete(table).where(…)` und
// `.select(...).from(table).where(...)` ab.

interface AssetRow {
  id: string;
  userId: string;
  kind: string;
  bunnyId: string;
  cdnUrl: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sourceHash: string | null;
}

interface RefRow {
  assetId: string;
  ownerType: string;
  ownerId: string;
}

const assetRows: AssetRow[] = [];
const refRows: RefRow[] = [];
let nextAssetId = 1;

vi.mock("@/lib/db", () => {
  // Drizzle-Table-Marker: wir prüfen identity nicht; wir routen alles
  // basierend auf der eingegebenen `target`-Spalten-Liste bzw. dem
  // values-Shape.
  return {
    db: {
      insert: (_table: unknown) => ({
        values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
          const v = Array.isArray(vals) ? vals[0] : vals;
          return {
            onConflictDoNothing: (_opts: unknown) => ({
              returning: (_proj: unknown) => {
                // Routing: assets haben `userId`+`kind`+`bunnyId`; refs
                // haben `assetId`+`ownerType`+`ownerId`.
                if ("bunnyId" in v) {
                  const existing = assetRows.find(
                    (r) =>
                      r.userId === v.userId &&
                      r.kind === v.kind &&
                      r.bunnyId === v.bunnyId,
                  );
                  if (existing) return Promise.resolve([]);
                  const row: AssetRow = {
                    id: `asset-${nextAssetId++}`,
                    userId: v.userId as string,
                    kind: v.kind as string,
                    bunnyId: v.bunnyId as string,
                    cdnUrl: v.cdnUrl as string,
                    width: (v.width as number) ?? null,
                    height: (v.height as number) ?? null,
                    bytes: (v.bytes as number) ?? null,
                    sourceHash: (v.sourceHash as string) ?? null,
                  };
                  assetRows.push(row);
                  return Promise.resolve([{ id: row.id }]);
                }
                return Promise.resolve([]);
              },
              // refs nutzen `.onConflictDoNothing(...)` ohne `.returning(...)`
              then: (resolve: (v: void) => unknown) => {
                if ("assetId" in v) {
                  const existing = refRows.find(
                    (r) =>
                      r.assetId === v.assetId &&
                      r.ownerType === v.ownerType &&
                      r.ownerId === v.ownerId,
                  );
                  if (!existing) {
                    refRows.push({
                      assetId: v.assetId as string,
                      ownerType: v.ownerType as string,
                      ownerId: v.ownerId as string,
                    });
                  }
                }
                return Promise.resolve().then(resolve);
              },
            }),
          };
        },
      }),
      select: (_proj: unknown) => ({
        from: (_table: unknown) => ({
          where: (_w: unknown) => ({
            limit: (_n: number) =>
              Promise.resolve(
                assetRows.length > 0 ? [{ id: assetRows[0].id }] : [],
              ),
            // alternative shape: select refs by owner (kein .limit)
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve(
                refRows.map((r) => ({ assetId: r.assetId })),
              ).then(resolve),
          }),
        }),
      }),
      delete: (_table: unknown) => ({
        where: (_w: unknown) => {
          // Diese ist ohne weitere Spezifikation kaum zu routen — wir
          // löschen alle Refs (Test-Setup ruft delete nur bei Cleanup).
          refRows.length = 0;
          return Promise.resolve();
        },
      }),
      update: (_table: unknown) => ({
        set: (_v: unknown) => ({
          where: (_w: unknown) => Promise.resolve(),
        }),
      }),
      execute: (_sql: unknown) => Promise.resolve({ count: 0 }),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  bunnyAssets: {
    id: "id",
    userId: "userId",
    kind: "kind",
    bunnyId: "bunnyId",
    purgeState: "purgeState",
    purgeAttempts: "purgeAttempts",
    createdAt: "createdAt",
  },
  bunnyAssetRefs: {
    assetId: "assetId",
    ownerType: "ownerType",
    ownerId: "ownerId",
  },
}));

// Imports werden nach den vi.mock-Calls aufgelöst (vitest hoisted).
import {
  addBunnyAssetRef,
  removeBunnyAssetRefsForOwner,
  trackBunnyAsset,
} from "@/lib/db/queries/bunny-assets";
import { trackAndRefAsset } from "@/worker/lib/bunny-asset-tracking";

beforeEach(() => {
  assetRows.length = 0;
  refRows.length = 0;
  nextAssetId = 1;
});

describe("bunny-asset-ref integration (Paket D regression guard)", () => {
  it("Test 1: trackBunnyAsset + addBunnyAssetRef schreibt genau eine ref-row", async () => {
    const { assetId } = await trackBunnyAsset({
      userId: "user-1",
      kind: "stream",
      bunnyId: "guid-1",
      cdnUrl: "https://vz-x.b-cdn.net/guid-1/playlist.m3u8",
    });
    expect(assetId).toBe("asset-1");

    await addBunnyAssetRef(assetId, "lead", "lead-1");

    const refsForAsset = refRows.filter((r) => r.assetId === assetId);
    expect(refsForAsset).toHaveLength(1);
  });

  it("Test 2: zweiter addBunnyAssetRef mit gleichem owner ist idempotent", async () => {
    const { assetId } = await trackBunnyAsset({
      userId: "user-1",
      kind: "stream",
      bunnyId: "guid-2",
      cdnUrl: "https://vz-x.b-cdn.net/guid-2/playlist.m3u8",
    });

    await addBunnyAssetRef(assetId, "lead", "lead-1");
    await addBunnyAssetRef(assetId, "lead", "lead-1");

    const refsForAsset = refRows.filter((r) => r.assetId === assetId);
    expect(refsForAsset).toHaveLength(1);
  });

  it("Test 3: removeBunnyAssetRefsForOwner entfernt die ref", async () => {
    const { assetId } = await trackBunnyAsset({
      userId: "user-1",
      kind: "stream",
      bunnyId: "guid-3",
      cdnUrl: "https://vz-x.b-cdn.net/guid-3/playlist.m3u8",
    });
    await addBunnyAssetRef(assetId, "lead", "lead-1");
    expect(refRows.filter((r) => r.assetId === assetId)).toHaveLength(1);

    await removeBunnyAssetRefsForOwner("lead", "lead-1");

    expect(refRows.filter((r) => r.assetId === assetId)).toHaveLength(0);
  });

  it("Regression: trackAndRefAsset Helper schreibt die Ref atomar (kein asset.id-Bug)", async () => {
    // Dies ist der eigentliche Regression-Guard: vor dem Fix las der
    // Pipeline-Code `asset.id` statt `asset.assetId` → undefined →
    // addBunnyAssetRef nie aufgerufen → Test würde 0 Refs sehen.
    const assetId = await trackAndRefAsset({
      trackInput: {
        userId: "user-1",
        kind: "stream",
        bunnyId: "guid-4",
        cdnUrl: "https://vz-x.b-cdn.net/guid-4/playlist.m3u8",
      },
      ownerType: "lead",
      ownerId: "lead-1",
    });

    expect(assetId).toBe("asset-1");
    expect(refRows.filter((r) => r.assetId === assetId)).toHaveLength(1);
  });
});
