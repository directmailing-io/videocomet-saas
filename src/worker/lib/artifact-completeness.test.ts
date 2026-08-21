/**
 * Completeness-Checks: fehlende Pflicht-Artefakte + Video-Shortfall.
 *
 * Enthält die volle Konfigurations-Matrix über alle Required-Dimensionen
 * (pdf × intro × envelope × ab): für jede der 16 Kombinationen wird
 * geprüft, dass genau die konfigurierten Pflicht-Bestandteile verlangt
 * werden — nicht mehr und nicht weniger (Invariante 2026-08-21).
 */

import { describe, expect, it } from "vitest";
import {
  ACCEPTED_INTRO_STATES,
  isDurationShortfall,
  isIntroHardFailure,
  missingLeadArtifacts,
  type LeadArtifactState,
} from "./artifact-completeness";

/** Vollständig erfolgreicher Lead für die jeweilige Konfiguration. */
function completeLead(
  overrides: Partial<LeadArtifactState> = {},
): LeadArtifactState {
  return {
    videoUrl: "https://cdn/video.m3u8",
    slug: "max-mustermann-1234",
    pdfUrl: "https://cdn/brief.pdf",
    pdfRequired: false,
    introRequired: false,
    introStatus: null,
    envelopeRequired: false,
    envelopePdfUrl: null,
    abRequired: false,
    abVariant: null,
    ...overrides,
  };
}

describe("missingLeadArtifacts — Basis", () => {
  it("vollständiger Lead → leere Liste", () => {
    expect(
      missingLeadArtifacts(
        completeLead({ pdfRequired: true, pdfUrl: "https://cdn/brief.pdf" }),
      ),
    ).toEqual([]);
  });

  it("fehlendes Video + fehlende Landingpage werden gemeldet", () => {
    const missing = missingLeadArtifacts(
      completeLead({ videoUrl: null, slug: null, pdfUrl: null }),
    );
    expect(missing).toEqual(["Video (videoUrl)", "Landingpage (slug)"]);
  });

  it("PDF nur Pflicht wenn pdfRequired", () => {
    const base = completeLead({ pdfUrl: null });
    expect(missingLeadArtifacts({ ...base, pdfRequired: false })).toEqual([]);
    expect(missingLeadArtifacts({ ...base, pdfRequired: true })).toEqual([
      "PDF-Brief (pdfUrl)",
    ]);
  });
});

describe("missingLeadArtifacts — KI-Begrüßung (Regression Vorfall 2026-08-21)", () => {
  // Der KI-Kampagnentest-Fall: Kalibrierung failed → introStatus='disabled',
  // Runde lief trotzdem als Erfolg durch. Mit introRequired MUSS das
  // jetzt als fehlend gemeldet werden.
  it("introRequired + introStatus=disabled → fehlend (der Produktions-Bug)", () => {
    const missing = missingLeadArtifacts(
      completeLead({ introRequired: true, introStatus: "disabled" }),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("KI-Begrüßung");
    expect(missing[0]).toContain("disabled");
  });

  it.each(["generated", "fallback_name"] as const)(
    "introRequired + introStatus=%s → ok (akzeptierte Endzustände)",
    (status) => {
      expect(
        missingLeadArtifacts(
          completeLead({ introRequired: true, introStatus: status }),
        ),
      ).toEqual([]);
    },
  );

  it.each(["fallback_error", "queued", "generating", null] as const)(
    "introRequired + introStatus=%s → fehlend",
    (status) => {
      const missing = missingLeadArtifacts(
        completeLead({ introRequired: true, introStatus: status }),
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain("KI-Begrüßung");
    },
  );

  it("ohne introRequired ist JEDER introStatus ok (bewusst ohne Begrüßung)", () => {
    for (const status of [
      null,
      "disabled",
      "fallback_error",
      "generated",
      "queued",
    ]) {
      expect(
        missingLeadArtifacts(
          completeLead({ introRequired: false, introStatus: status }),
        ),
      ).toEqual([]);
    }
  });

  it("akzeptierte Zustände sind exakt generated + fallback_name", () => {
    expect([...ACCEPTED_INTRO_STATES].sort()).toEqual([
      "fallback_name",
      "generated",
    ]);
  });
});

describe("missingLeadArtifacts — Umschlag + A/B", () => {
  it("envelopeRequired ohne envelopePdfUrl → fehlend", () => {
    const missing = missingLeadArtifacts(
      completeLead({ envelopeRequired: true, envelopePdfUrl: null }),
    );
    expect(missing).toEqual(["Umschlag (envelopePdfUrl)"]);
  });

  it("envelopeRequired mit envelopePdfUrl → ok", () => {
    expect(
      missingLeadArtifacts(
        completeLead({
          envelopeRequired: true,
          envelopePdfUrl: "https://cdn/umschlag.pdf",
        }),
      ),
    ).toEqual([]);
  });

  it.each(["A", "B"] as const)("abRequired + Variante %s → ok", (v) => {
    expect(
      missingLeadArtifacts(completeLead({ abRequired: true, abVariant: v })),
    ).toEqual([]);
  });

  it.each([null, "", "C"] as const)(
    "abRequired + abVariant=%s → fehlend (Lead zählt in keiner Statistik)",
    (v) => {
      const missing = missingLeadArtifacts(
        completeLead({ abRequired: true, abVariant: v }),
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain("A/B-Variante");
    },
  );
});

describe("missingLeadArtifacts — volle Konfigurations-Matrix (16 Kombinationen)", () => {
  const bools = [false, true] as const;
  for (const pdf of bools) {
    for (const intro of bools) {
      for (const envelope of bools) {
        for (const ab of bools) {
          const label = `pdf=${pdf} intro=${intro} envelope=${envelope} ab=${ab}`;

          it(`${label}: vollständiger Lead → ok`, () => {
            expect(
              missingLeadArtifacts(
                completeLead({
                  pdfRequired: pdf,
                  pdfUrl: pdf ? "https://cdn/brief.pdf" : null,
                  introRequired: intro,
                  introStatus: intro ? "generated" : null,
                  envelopeRequired: envelope,
                  envelopePdfUrl: envelope ? "https://cdn/umschlag.pdf" : null,
                  abRequired: ab,
                  abVariant: ab ? "A" : null,
                }),
              ),
            ).toEqual([]);
          });

          it(`${label}: alle Artefakte fehlen → genau die konfigurierten werden gemeldet`, () => {
            const missing = missingLeadArtifacts(
              completeLead({
                videoUrl: null,
                slug: null,
                pdfRequired: pdf,
                pdfUrl: null,
                introRequired: intro,
                introStatus: intro ? "disabled" : null,
                envelopeRequired: envelope,
                envelopePdfUrl: null,
                abRequired: ab,
                abVariant: null,
              }),
            );
            const expectedCount =
              2 + // Video + Landingpage immer
              (pdf ? 1 : 0) +
              (intro ? 1 : 0) +
              (envelope ? 1 : 0) +
              (ab ? 1 : 0);
            expect(missing).toHaveLength(expectedCount);
            expect(missing.some((m) => m.includes("PDF-Brief"))).toBe(pdf);
            expect(missing.some((m) => m.includes("KI-Begrüßung"))).toBe(intro);
            expect(missing.some((m) => m.includes("Umschlag"))).toBe(envelope);
            expect(missing.some((m) => m.includes("A/B-Variante"))).toBe(ab);
          });
        }
      }
    }
  }
});

describe("isIntroHardFailure — Stage-0-Fail-Fast", () => {
  it.each(["disabled", "fallback_error"] as const)(
    "introExpected=true + introStatus=%s → sofort abbrechen (kein teurer Render)",
    (status) => {
      expect(isIntroHardFailure(true, status)).toBe(true);
    },
  );

  it.each(["generated", "fallback_name", "queued", "generating", null] as const)(
    "introExpected=true + introStatus=%s → KEIN Abbruch",
    (status) => {
      expect(isIntroHardFailure(true, status)).toBe(false);
    },
  );

  it.each([false, null, undefined] as const)(
    "introExpected=%s → nie abbrechen, egal welcher Status (bewusst ohne Begrüßung / Legacy)",
    (expected) => {
      for (const status of ["disabled", "fallback_error", null]) {
        expect(isIntroHardFailure(expected, status)).toBe(false);
      }
    },
  );
});

describe("isDurationShortfall", () => {
  it("probe null (ffprobe-Glitch) → kein Shortfall", () => {
    expect(isDurationShortfall(60, null)).toBe(false);
  });

  it("kleine Codec-Abweichung innerhalb Toleranz → ok", () => {
    expect(isDurationShortfall(60, 59.0)).toBe(false);
    expect(isDurationShortfall(149, 146.5)).toBe(false); // 2% = 2.98s
  });

  it("fehlendes Segment (deutlich kürzer) → Shortfall", () => {
    expect(isDurationShortfall(60, 55)).toBe(true);
    expect(isDurationShortfall(149, 127.4)).toBe(true); // 21.6s Schluss-Szene fehlt
  });

  it("zu lang ist KEIN Shortfall (wird separat getrimmt)", () => {
    expect(isDurationShortfall(60, 65)).toBe(false);
  });
});
