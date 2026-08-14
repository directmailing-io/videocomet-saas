import { describe, expect, it } from "vitest";
import { parseDraftEnvelope } from "./use-wizard-draft";
import type { WizardState } from "./wizard-container";

/**
 * Draft-Kompatibilität für den Studio-Modus (`recordingKind`):
 *  - Alte Envelopes OHNE das Feld müssen weiterhin laden (Default "classic").
 *  - Studio-Drafts müssen das Feld nach Reload behalten.
 *  - Unbekannte Werte gelten als Schema-Drift → Envelope wird verworfen.
 */

/** Vollständiger, valider Wizard-State im Envelope-v4-Format. */
function baseState(): WizardState {
  return {
    name: "Test-Kampagne",
    webcamMediaId: "media-1",
    mode: "webcam-only",
    segments: [],
    pipPosition: "bottom-left",
    pipShape: "rounded",
    landingPageTemplateId: null,
    customLpTemplateId: null,
    domainId: null,
    slugTemplate: null,
    pdfEnabled: false,
    pdfGoogleDocsUrl: "",
    abTestingEnabled: false,
    pdfGoogleDocsUrlB: "",
    abSplitMode: "random",
    abSplitWeightA: 50,
    pdfQrEnabled: false,
    pdfThumbnailEnabled: false,
    pdfThumbnailFrameMs: null,
    thumbnailImageEnabled: false,
    thumbnailImage: null,
    thumbnailMode: "frame",
    thumbnailPlayIcon: false,
    introEnabled: false,
    introGreetingPrefix: "Hi",
    introNamePattern: "firstName",
  };
}

function envelope(state: unknown, step = 1): unknown {
  return {
    version: 4,
    savedAt: new Date().toISOString(),
    state,
    step,
  };
}

describe("parseDraftEnvelope — recordingKind", () => {
  it("lädt alte Drafts ohne recordingKind und defaultet auf 'classic'", () => {
    const state = baseState();
    // Alte Drafts kennen das Feld schlicht nicht.
    delete (state as Partial<WizardState>).recordingKind;
    const parsed = parseDraftEnvelope(envelope(state));
    expect(parsed).not.toBeNull();
    expect(parsed?.state.recordingKind).toBe("classic");
  });

  it("behält recordingKind 'studio' beim Reload", () => {
    const state: WizardState = {
      ...baseState(),
      recordingKind: "studio",
      mode: "with-presentation",
    };
    const parsed = parseDraftEnvelope(envelope(state, 3));
    expect(parsed).not.toBeNull();
    expect(parsed?.state.recordingKind).toBe("studio");
    expect(parsed?.state.mode).toBe("with-presentation");
    expect(parsed?.step).toBe(3);
  });

  it("behält recordingKind 'classic' unverändert", () => {
    const state: WizardState = { ...baseState(), recordingKind: "classic" };
    const parsed = parseDraftEnvelope(envelope(state));
    expect(parsed?.state.recordingKind).toBe("classic");
  });

  it("verwirft Envelopes mit unbekanntem recordingKind (Schema-Drift)", () => {
    const state = { ...baseState(), recordingKind: "hologram" };
    expect(parseDraftEnvelope(envelope(state))).toBeNull();
  });

  it("verwirft weiterhin komplett kaputte Envelopes", () => {
    expect(parseDraftEnvelope(null)).toBeNull();
    expect(parseDraftEnvelope({ version: 4 })).toBeNull();
    expect(parseDraftEnvelope(envelope({ name: 42 }))).toBeNull();
  });
});
