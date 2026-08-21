/**
 * checkRunReadiness — zentrale Vorab-Prüfung aller Run-Start-Pfade
 * (Reliability 2026-08-21, Vorfall: from-list startete Intro-Kampagne
 * ohne bereite Kalibrierung → Runde still ohne KI-Begrüßung).
 *
 * `@/lib/db` wird durch ein tabellen-basiertes Mock ersetzt: jede
 * select().from(TABLE) liefert das für TABLE hinterlegte Ergebnis —
 * so bleiben die Tests unabhängig davon, in welcher Reihenfolge und ob
 * überhaupt (bedingte Lookups!) eine Tabelle abgefragt wird.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: new Map<unknown, unknown[]>(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => Promise.resolve(state.tables.get(table) ?? []),
        }),
      }),
    }),
  },
}));

import {
  campaigns,
  envelopeTemplates,
  introCalibrations,
  mediaItems,
  voiceProfiles,
} from "@/lib/db/schema";
import { checkRunReadiness } from "./run-readiness";

const USER = "user-1";
const CAMPAIGN = "camp-1";

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    mode: "webcam-only",
    segments: null,
    webcamMediaId: "media-1",
    pdfEnabled: false,
    pdfGoogleDocsUrl: null,
    introEnabled: false,
    envelopeTemplateId: null,
    ...overrides,
  };
}

function setCampaign(overrides: Record<string, unknown> = {}) {
  state.tables.set(campaigns, [baseCampaign(overrides)]);
}

function setWebcamOk() {
  state.tables.set(mediaItems, [{ publicUrl: "https://cdn/webcam.mp4" }]);
}

function check(input?: Partial<Parameters<typeof checkRunReadiness>[0]>) {
  return checkRunReadiness({
    userId: USER,
    campaignId: CAMPAIGN,
    requireIntroReady: true,
    ...input,
  });
}

function codes(res: Awaited<ReturnType<typeof checkRunReadiness>>) {
  return res.blockers.map((b) => b.code);
}

beforeEach(() => {
  state.tables = new Map();
});

describe("checkRunReadiness — Basis", () => {
  it("Kampagne existiert nicht → einziger Blocker campaign_not_found", async () => {
    const res = await check();
    expect(res.ok).toBe(false);
    expect(codes(res)).toEqual(["campaign_not_found"]);
  });

  it("einfache webcam-only-Kampagne mit Webcam-Video → ok", async () => {
    setCampaign();
    setWebcamOk();
    const res = await check();
    expect(res.ok).toBe(true);
    expect(res.blockers).toEqual([]);
    expect(res.introEnabled).toBe(false);
    expect(res.introReady).toBe(false);
  });

  it("Blocker-Meldungen sind deutsch und laienverständlich (Oma-Test)", async () => {
    setCampaign({ webcamMediaId: null });
    const res = await check();
    expect(res.blockers[0].message).toContain("Webcam-Video");
    expect(res.blockers[0].message).not.toMatch(/null|undefined|publicUrl/);
  });
});

describe("checkRunReadiness — Webcam", () => {
  it("kein webcamMediaId → webcam_missing", async () => {
    setCampaign({ webcamMediaId: null });
    const res = await check();
    expect(codes(res)).toContain("webcam_missing");
  });

  it("webcamMediaId zeigt auf Media ohne publicUrl → webcam_missing", async () => {
    setCampaign();
    state.tables.set(mediaItems, [{ publicUrl: null }]);
    const res = await check();
    expect(codes(res)).toContain("webcam_missing");
  });

  it("webcamMediaId zeigt auf gelöschtes Media (kein Row) → webcam_missing", async () => {
    setCampaign();
    state.tables.set(mediaItems, []);
    const res = await check();
    expect(codes(res)).toContain("webcam_missing");
  });
});

describe("checkRunReadiness — Segmente + PDF", () => {
  it("with-presentation ohne Segmente → segments_missing", async () => {
    setCampaign({ mode: "with-presentation", segments: [] });
    setWebcamOk();
    const res = await check();
    expect(codes(res)).toEqual(["segments_missing"]);
  });

  it("with-presentation mit Segmenten → ok", async () => {
    setCampaign({ mode: "with-presentation", segments: [{ type: "webcam" }] });
    setWebcamOk();
    const res = await check();
    expect(res.ok).toBe(true);
  });

  it("webcam-only braucht KEINE Segmente", async () => {
    setCampaign({ mode: "webcam-only", segments: null });
    setWebcamOk();
    const res = await check();
    expect(res.ok).toBe(true);
  });

  it("pdfEnabled ohne Google-Docs-URL → pdf_url_missing", async () => {
    setCampaign({ pdfEnabled: true, pdfGoogleDocsUrl: null });
    setWebcamOk();
    const res = await check();
    expect(codes(res)).toEqual(["pdf_url_missing"]);
  });

  it("pdfEnabled mit Whitespace-URL → pdf_url_missing", async () => {
    setCampaign({ pdfEnabled: true, pdfGoogleDocsUrl: "   " });
    setWebcamOk();
    const res = await check();
    expect(codes(res)).toEqual(["pdf_url_missing"]);
  });

  it("pdfEnabled mit URL → ok", async () => {
    setCampaign({
      pdfEnabled: true,
      pdfGoogleDocsUrl: "https://docs.google.com/document/d/abc",
    });
    setWebcamOk();
    const res = await check();
    expect(res.ok).toBe(true);
  });
});

describe("checkRunReadiness — KI-Begrüßung (Regression Vorfall 2026-08-21)", () => {
  function setIntroCampaign() {
    setCampaign({ introEnabled: true });
    setWebcamOk();
  }

  it("Kalibrierung fehlt komplett → intro_not_ready (der from-list-Bug)", async () => {
    setIntroCampaign();
    const res = await check({ requireIntroReady: true });
    expect(res.ok).toBe(false);
    expect(codes(res)).toEqual(["intro_not_ready"]);
    expect(res.introEnabled).toBe(true);
    expect(res.introReady).toBe(false);
  });

  it("requireIntroReady=false (/start hat eigenes Opt-out-Gate) → kein Blocker, aber introReady=false", async () => {
    setIntroCampaign();
    const res = await check({ requireIntroReady: false });
    expect(res.ok).toBe(true);
    expect(res.introEnabled).toBe(true);
    expect(res.introReady).toBe(false);
  });

  it("Kampagnen-Stimme ready + Kalibrierung ready → introReady", async () => {
    setIntroCampaign();
    state.tables.set(introCalibrations, [
      { status: "ready", voiceStatus: "ready", voiceFishModelId: "fish-1" },
    ]);
    const res = await check();
    expect(res.ok).toBe(true);
    expect(res.introReady).toBe(true);
  });

  it("Account-Stimme ready als Fallback (Kampagnen-Stimme nicht ready) → introReady", async () => {
    setIntroCampaign();
    state.tables.set(voiceProfiles, [{ status: "ready" }]);
    state.tables.set(introCalibrations, [
      { status: "ready", voiceStatus: "pending", voiceFishModelId: null },
    ]);
    const res = await check();
    expect(res.introReady).toBe(true);
  });

  it("Stimme ready, aber Kalibrierung failed → intro_not_ready", async () => {
    setIntroCampaign();
    state.tables.set(voiceProfiles, [{ status: "ready" }]);
    state.tables.set(introCalibrations, [
      { status: "failed", voiceStatus: "pending", voiceFishModelId: null },
    ]);
    const res = await check();
    expect(codes(res)).toEqual(["intro_not_ready"]);
  });

  it("Kampagnen-Stimme ready laut voiceStatus, aber ohne fishModelId → zählt nicht", async () => {
    setIntroCampaign();
    state.tables.set(introCalibrations, [
      { status: "ready", voiceStatus: "ready", voiceFishModelId: null },
    ]);
    const res = await check();
    expect(codes(res)).toEqual(["intro_not_ready"]);
  });

  it("introEnabled ohne Webcam → webcam_missing UND intro_not_ready", async () => {
    setCampaign({ introEnabled: true, webcamMediaId: null });
    const res = await check();
    expect(codes(res)).toEqual(
      expect.arrayContaining(["webcam_missing", "intro_not_ready"]),
    );
  });
});

describe("checkRunReadiness — Umschlag-Vorlage", () => {
  it("Kampagnen-Vorlage existiert → ok", async () => {
    setCampaign({ envelopeTemplateId: "tpl-1" });
    setWebcamOk();
    state.tables.set(envelopeTemplates, [{ id: "tpl-1" }]);
    const res = await check();
    expect(res.ok).toBe(true);
  });

  it("Kampagnen-Vorlage gelöscht → envelope_template_missing", async () => {
    setCampaign({ envelopeTemplateId: "tpl-1" });
    setWebcamOk();
    state.tables.set(envelopeTemplates, []);
    const res = await check();
    expect(codes(res)).toEqual(["envelope_template_missing"]);
  });

  it("Runden-Override wird geprüft, auch wenn Kampagne keine Vorlage hat", async () => {
    setCampaign();
    setWebcamOk();
    state.tables.set(envelopeTemplates, []);
    const res = await check({ envelopeTemplateIdOverride: "tpl-override" });
    expect(codes(res)).toEqual(["envelope_template_missing"]);
  });

  it("ohne Vorlage (Kampagne + Override leer) → keine Umschlag-Prüfung", async () => {
    setCampaign();
    setWebcamOk();
    const res = await check({ envelopeTemplateIdOverride: null });
    expect(res.ok).toBe(true);
  });
});

describe("checkRunReadiness — mehrere Blocker gleichzeitig", () => {
  it("alles kaputt → alle Blocker in einer Antwort (kein Fail-Fast)", async () => {
    setCampaign({
      mode: "with-presentation",
      segments: [],
      webcamMediaId: null,
      pdfEnabled: true,
      pdfGoogleDocsUrl: null,
      introEnabled: true,
      envelopeTemplateId: "tpl-1",
    });
    state.tables.set(envelopeTemplates, []);
    const res = await check();
    expect(res.ok).toBe(false);
    expect(codes(res).sort()).toEqual(
      [
        "envelope_template_missing",
        "intro_not_ready",
        "pdf_url_missing",
        "segments_missing",
        "webcam_missing",
      ].sort(),
    );
  });
});
