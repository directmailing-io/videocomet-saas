import { describe, expect, it } from "vitest";
import { collapseVideoEvents, collapsedVideoLabel, progressLabel } from "./video-progress-label";

const t = (s: number) => new Date(Date.UTC(2026, 8, 3, 12, 0, s)).toISOString();

describe("video-progress-label", () => {
  it("beschriftet alte und neue Payloads", () => {
    expect(progressLabel({ atSec: 45, duration: 90 })).toBe("Video gesehen 50 %");
    expect(progressLabel({ coveragePct: 20, atSec: 70, durationSec: 100 })).toBe("Video gesehen 20 %");
    expect(progressLabel({ atSec: 12 })).toBe("Video bei 12 s");
  });

  it("verdichtet Ticks einer Sitzung zu einem Eintrag mit Endstand", () => {
    const events = [
      { eventId: "1", ts: t(0), kind: "page_view", payload: null },
      { eventId: "2", ts: t(5), kind: "video_play", payload: { atSec: 0 } },
      { eventId: "3", ts: t(10), kind: "video_progress", payload: { atSec: 5, duration: 100 } },
      { eventId: "4", ts: t(15), kind: "video_progress", payload: { atSec: 10, duration: 100 } },
      { eventId: "5", ts: t(20), kind: "video_progress", payload: { atSec: 15, duration: 100 } },
      { eventId: "6", ts: t(25), kind: "cta_click", payload: null },
      { eventId: "7", ts: t(30), kind: "video_progress", payload: { atSec: 96, duration: 100 } },
    ];
    const out = collapseVideoEvents(events);
    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["video_session", "cta_click", "page_view"]);
    const session = out[0] as ReturnType<typeof collapseVideoEvents>[number] & { pct: number; count: number };
    expect(session.pct).toBe(96);
    expect(session.count).toBe(5);
    expect(collapsedVideoLabel(session as never)).toBe("Video angesehen: 96 %");
  });

  it("neue Sitzung nach Pause > 5 Minuten oder nach Ende", () => {
    const events = [
      { eventId: "a", ts: t(0), kind: "video_play", payload: {} },
      { eventId: "b", ts: t(5), kind: "video_progress", payload: { coveragePct: 30 } },
      { eventId: "c", ts: t(600), kind: "video_play", payload: {} },
      { eventId: "d", ts: t(605), kind: "video_ended", payload: { coveragePct: 100 } },
    ];
    const out = collapseVideoEvents(events);
    expect(out).toHaveLength(2);
    expect(collapsedVideoLabel(out[0] as never)).toBe("Video komplett gesehen");
    expect(collapsedVideoLabel(out[1] as never)).toBe("Video angesehen: 30 %");
  });
});
