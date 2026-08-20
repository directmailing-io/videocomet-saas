/**
 * Completeness-Checks: fehlende Pflicht-Artefakte + Video-Shortfall.
 */

import { describe, expect, it } from "vitest";
import {
  isDurationShortfall,
  missingLeadArtifacts,
} from "./artifact-completeness";

describe("missingLeadArtifacts", () => {
  it("vollständiger Lead → leere Liste", () => {
    expect(
      missingLeadArtifacts({
        videoUrl: "https://cdn/video.m3u8",
        slug: "max-mustermann-1234",
        pdfUrl: "https://cdn/brief.pdf",
        pdfRequired: true,
      }),
    ).toEqual([]);
  });

  it("fehlendes Video + fehlende Landingpage werden gemeldet", () => {
    const missing = missingLeadArtifacts({
      videoUrl: null,
      slug: null,
      pdfUrl: null,
      pdfRequired: false,
    });
    expect(missing).toEqual(["Video (videoUrl)", "Landingpage (slug)"]);
  });

  it("PDF nur Pflicht wenn pdfRequired", () => {
    const base = {
      videoUrl: "v",
      slug: "s",
      pdfUrl: null,
    };
    expect(missingLeadArtifacts({ ...base, pdfRequired: false })).toEqual([]);
    expect(missingLeadArtifacts({ ...base, pdfRequired: true })).toEqual([
      "PDF-Brief (pdfUrl)",
    ]);
  });
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
