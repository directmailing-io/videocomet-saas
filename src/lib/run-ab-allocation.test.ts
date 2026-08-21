/**
 * allocateAbVariantsForRun — gemeinsame A/B-Zuteilung beider Start-Pfade
 * (extrahiert 2026-08-21; vorher startete from-list OHNE Zuteilung und
 * Leads liefen still als Variante A ohne Statistik-Zählung).
 *
 * `@/lib/db` wird gemockt: die Lead-Liste kommt aus dem Test, alle
 * UPDATE-Aufrufe werden mitgeschnitten (Ziel-Tabelle + Patch + Lead-IDs
 * aus der inArray-WHERE-Klausel).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  eligible: [] as Array<{ id: string; rowIndex: number }>,
  updates: [] as Array<{
    table: unknown;
    patch: Record<string, unknown>;
    params: unknown[];
  }>,
}));

/** Sammelt alle Parameter-Werte (z.B. Lead-IDs aus inArray) aus einem
 *  Drizzle-SQL-Baum. StringChunks (value als Array) werden übersprungen. */
const collectParams = vi.hoisted(() => {
  const fn = (node: unknown, out: unknown[] = []): unknown[] => {
    if (node == null || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      for (const n of node) fn(n, out);
      return out;
    }
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.queryChunks)) fn(o.queryChunks, out);
    if ("value" in o) {
      if (Array.isArray(o.value)) {
        // StringChunk ODER Array-Param — nur echte Werte übernehmen
        for (const v of o.value) if (typeof v !== "string" || v.length > 2) out.push(v);
      } else {
        out.push(o.value);
      }
    }
    return out;
  };
  return fn;
});

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(state.eligible),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          state.updates.push({ table, patch, params: collectParams(cond) });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { leads, runs } from "@/lib/db/schema";
import {
  allocateAbVariantsForRun,
  type AbCampaignConfig,
} from "./run-ab-allocation";

function abCampaign(overrides: Partial<AbCampaignConfig> = {}): AbCampaignConfig {
  return {
    abTestingEnabled: true,
    pdfEnabled: true,
    pdfGoogleDocsUrl: "https://docs.google.com/document/d/AAA",
    pdfGoogleDocsUrlB: "https://docs.google.com/document/d/BBB",
    abSplitMode: "sequential",
    abSplitWeightA: 50,
    ...overrides,
  };
}

function makeLeads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `lead-${i}`,
    rowIndex: i,
  }));
}

function variantUpdate(variant: "A" | "B") {
  return state.updates.find(
    (u) => u.table === leads && u.patch.abVariant === variant,
  );
}

function idsOf(variant: "A" | "B"): string[] {
  return (variantUpdate(variant)?.params ?? []).filter(
    (p): p is string => typeof p === "string" && p.startsWith("lead-"),
  );
}

beforeEach(() => {
  state.eligible = [];
  state.updates = [];
});

describe("allocateAbVariantsForRun — Aktivierungs-Bedingungen", () => {
  it.each([
    ["abTestingEnabled=false", { abTestingEnabled: false }],
    ["pdfEnabled=false", { pdfEnabled: false }],
    ["urlA fehlt", { pdfGoogleDocsUrl: null }],
    ["urlA leer", { pdfGoogleDocsUrl: "   " }],
    ["urlB fehlt", { pdfGoogleDocsUrlB: null }],
    ["urlB leer", { pdfGoogleDocsUrlB: "" }],
  ] as const)("%s → null, keine DB-Writes", async (_label, overrides) => {
    const res = await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign(overrides),
    });
    expect(res).toBeNull();
    expect(state.updates).toHaveLength(0);
  });
});

describe("allocateAbVariantsForRun — sequential", () => {
  it("50/50 bei 4 Leads → erste 2 A, letzte 2 B, Snapshot persistiert", async () => {
    state.eligible = makeLeads(4);
    const res = await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign(),
    });

    expect(idsOf("A")).toEqual(["lead-0", "lead-1"]);
    expect(idsOf("B")).toEqual(["lead-2", "lead-3"]);
    expect(res).toEqual({
      mode: "sequential",
      weightA: 50,
      urlA: "https://docs.google.com/document/d/AAA",
      urlB: "https://docs.google.com/document/d/BBB",
    });
    // Snapshot landet auf dem Run (persistToRun default true)
    const runUpdate = state.updates.find((u) => u.table === runs);
    expect(runUpdate?.patch.abConfig).toEqual(res);
  });

  it("Rundung: 3 Leads bei 50% → round(1.5)=2 A, 1 B", async () => {
    state.eligible = makeLeads(3);
    await allocateAbVariantsForRun({ runId: "run-1", campaign: abCampaign() });
    expect(idsOf("A")).toHaveLength(2);
    expect(idsOf("B")).toHaveLength(1);
  });

  it("weightA=100 → alle A, kein B-Update", async () => {
    state.eligible = makeLeads(5);
    await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign({ abSplitWeightA: 100 }),
    });
    expect(idsOf("A")).toHaveLength(5);
    expect(variantUpdate("B")).toBeUndefined();
  });

  it("weightA=0 → alle B, kein A-Update", async () => {
    state.eligible = makeLeads(5);
    await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign({ abSplitWeightA: 0 }),
    });
    expect(variantUpdate("A")).toBeUndefined();
    expect(idsOf("B")).toHaveLength(5);
  });
});

describe("allocateAbVariantsForRun — random (exakte Quote)", () => {
  it("30% bei 10 Leads → exakt 3 A und 7 B, disjunkt und vollständig", async () => {
    state.eligible = makeLeads(10);
    await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign({ abSplitMode: "random", abSplitWeightA: 30 }),
    });
    const a = idsOf("A");
    const b = idsOf("B");
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(7);
    const all = [...a, ...b].sort();
    expect(all).toEqual(makeLeads(10).map((l) => l.id).sort());
  });
});

describe("allocateAbVariantsForRun — Optionen", () => {
  it("abRequest-Override schlägt die Kampagnen-Regel", async () => {
    state.eligible = makeLeads(4);
    const res = await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign({ abSplitMode: "random", abSplitWeightA: 50 }),
      abRequest: { mode: "sequential", weightA: 25 },
    });
    expect(res?.mode).toBe("sequential");
    expect(res?.weightA).toBe(25);
    expect(idsOf("A")).toEqual(["lead-0"]); // round(4·25%)=1
  });

  it("persistToRun=false → kein runs-Update, Snapshot trotzdem zurückgegeben", async () => {
    state.eligible = makeLeads(2);
    const res = await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign(),
      persistToRun: false,
    });
    expect(res).not.toBeNull();
    expect(state.updates.some((u) => u.table === runs)).toBe(false);
  });

  it("URLs werden getrimmt in den Snapshot geschrieben", async () => {
    state.eligible = makeLeads(2);
    const res = await allocateAbVariantsForRun({
      runId: "run-1",
      campaign: abCampaign({
        pdfGoogleDocsUrl: "  https://docs.google.com/document/d/AAA  ",
        pdfGoogleDocsUrlB: " https://docs.google.com/document/d/BBB ",
      }),
    });
    expect(res?.urlA).toBe("https://docs.google.com/document/d/AAA");
    expect(res?.urlB).toBe("https://docs.google.com/document/d/BBB");
  });
});
