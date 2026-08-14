import { describe, expect, it } from "vitest";
import type { Segment, TextSegment, WebsiteSegment } from "@/lib/segments/types";
import {
  deriveStudioSegments,
  removeDerivedSegment,
} from "./derive-segments";
import type { StudioEvent, StudioTab } from "./types";

function websiteSegment(id: string): WebsiteSegment {
  return {
    id,
    kind: "website",
    durationMs: 5000,
    urlColumn: "",
    fallbackUrl: "https://example.com",
    captureMode: "static-hero",
  };
}

function textSegment(id: string): TextSegment {
  return {
    id,
    kind: "text",
    durationMs: 5000,
    text: "Hallo",
    bgColor: "#FFFFFF",
    textColor: "#000000",
    fontSize: 48,
    textAlign: "center",
    fontWeight: "600",
    italic: false,
  };
}

function tab(id: string, segment: Segment): StudioTab {
  return { id, segment };
}

function sumDurations(list: ReturnType<typeof deriveStudioSegments>): number {
  return list.reduce((acc, d) => acc + d.segment.durationMs, 0);
}

describe("deriveStudioSegments", () => {
  it("liefert ein Segment über die volle Dauer bei einem Tab ohne Scroll", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [{ t: 120, type: "tabSwitch", tabId: "a" }];
    const out = deriveStudioSegments(tabs, events, 10_000);
    expect(out).toHaveLength(1);
    expect(out[0].segment.durationMs).toBe(10_000);
    expect(out[0].startMs).toBe(0);
    expect(out[0].tabId).toBe("a");
    expect(out[0].flagged).toBe(false);
    expect((out[0].segment as WebsiteSegment).captureMode).toBe("static-hero");
    expect((out[0].segment as WebsiteSegment).scrollFrames).toBeUndefined();
  });

  it("vergibt neue UUIDs statt der Draft-IDs", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const out = deriveStudioSegments(
      tabs,
      [{ t: 0, type: "tabSwitch", tabId: "a" }],
      5000,
    );
    expect(out[0].segment.id).not.toBe("seg-a");
    const again = deriveStudioSegments(
      tabs,
      [{ t: 0, type: "tabSwitch", tabId: "a" }],
      5000,
    );
    expect(again[0].segment.id).not.toBe(out[0].segment.id);
  });

  it("klemmt den ersten Wechsel auf t=0 und teilt an weiteren Wechseln", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 90, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    expect(out).toHaveLength(2);
    expect(out[0].segment.durationMs).toBe(4000);
    expect(out[1].segment.durationMs).toBe(6000);
    expect(out[1].startMs).toBe(4000);
  });

  it("ignoriert Folge-Wechsel auf denselben Tab", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "tabSwitch", tabId: "a" },
      { t: 5000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    expect(out).toHaveLength(2);
    expect(out[0].segment.durationMs).toBe(5000);
  });

  it("entfernt Null-Dauer-Segmente (zwei Wechsel im selben Moment)", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
      tab("c", textSegment("seg-c")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 3000, type: "tabSwitch", tabId: "b" },
      { t: 3000, type: "tabSwitch", tabId: "c" },
    ];
    const out = deriveStudioSegments(tabs, events, 9000);
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.tabId)).toEqual(["a", "c"]);
    expect(sumDurations(out)).toBe(9000);
  });

  it("synthetisiert den ersten Tab, wenn keine Wechsel-Events vorliegen", () => {
    const tabs = [tab("a", textSegment("seg-a"))];
    const out = deriveStudioSegments(tabs, [], 6000);
    expect(out).toHaveLength(1);
    expect(out[0].tabId).toBe("a");
    expect(out[0].segment.durationMs).toBe(6000);
  });

  it("renormiert ScrollFrames auf den Segment-Start und beginnt bei t=0", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 5000, type: "scroll", tabId: "b", y: 0.25 },
      { t: 6000, type: "scroll", tabId: "b", y: 0.5 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[1].segment as WebsiteSegment;
    expect(seg.captureMode).toBe("scroll-recorded");
    expect(seg.scrollFrames).toEqual([
      { t: 0, y: 0 },
      { t: 1000, y: 0.25 },
      { t: 2000, y: 0.5 },
    ]);
  });

  it("klemmt Scroll-Werte auf 0..1", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "scroll", tabId: "a", y: 1.4 },
      { t: 2000, type: "scroll", tabId: "a", y: -0.2 },
    ];
    const out = deriveStudioSegments(tabs, events, 5000);
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.scrollFrames).toEqual([
      { t: 0, y: 0 },
      { t: 1000, y: 1 },
      { t: 2000, y: 0 },
    ]);
  });

  it("merkt sich die Scroll-Position pro Tab zwischen Besuchen", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "scroll", tabId: "a", y: 0.6 },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 7000, type: "tabSwitch", tabId: "a" },
    ];
    const out = deriveStudioSegments(tabs, events, 12_000);
    expect(out).toHaveLength(3);
    const revisit = out[2].segment as WebsiteSegment;
    // Startet bei gemerktem y=0.6 → scroll-recorded trotz fehlender Bewegung.
    expect(revisit.captureMode).toBe("scroll-recorded");
    expect(revisit.scrollFrames).toEqual([{ t: 0, y: 0.6 }]);
  });

  it("bleibt static-hero ohne Bewegung bei y=0", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "scroll", tabId: "a", y: 0 },
      { t: 2000, type: "scroll", tabId: "a", y: 0 },
    ];
    const out = deriveStudioSegments(tabs, events, 5000);
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.captureMode).toBe("static-hero");
    expect(seg.scrollFrames).toBeUndefined();
  });

  it("kopiert nicht scrollbare Segmente unverändert (nur Dauer + ID neu)", () => {
    const draft = textSegment("seg-a");
    const tabs = [tab("a", draft)];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "scroll", tabId: "a", y: 0.5 },
    ];
    const out = deriveStudioSegments(tabs, events, 8000);
    const seg = out[0].segment as TextSegment;
    expect(seg.kind).toBe("text");
    expect(seg.text).toBe("Hallo");
    expect(seg.durationMs).toBe(8000);
    expect("scrollFrames" in seg).toBe(false);
  });

  it("bucht kleine ffprobe-Abweichungen (≤1 s) auf das letzte Segment", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 10_300 });
    expect(out[0].segment.durationMs).toBe(4000);
    expect(out[1].segment.durationMs).toBe(6300);
    expect(sumDurations(out)).toBe(10_300);

    const shorter = deriveStudioSegments(tabs, events, 10_000, {
      totalMs: 9800,
    });
    expect(shorter[0].segment.durationMs).toBe(4000);
    expect(shorter[1].segment.durationMs).toBe(5800);
  });

  it("skaliert proportional bei Abweichungen über 1 s", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 5000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 12_000 });
    expect(out[0].segment.durationMs).toBe(6000);
    expect(out[1].segment.durationMs).toBe(6000);
    expect(sumDurations(out)).toBe(12_000);
  });

  it("skaliert auch die Scroll-Zeiten mit", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 5000, type: "scroll", tabId: "a", y: 1 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 20_000 });
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.durationMs).toBe(20_000);
    expect(seg.scrollFrames).toEqual([
      { t: 0, y: 0 },
      { t: 10_000, y: 1 },
    ]);
  });

  it("weicht auf proportionale Skalierung aus, wenn das Delta das letzte Segment auslöschen würde", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 9500, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 9100 });
    expect(out).toHaveLength(2);
    expect(sumDurations(out)).toBe(9100);
    expect(out[1].segment.durationMs).toBeGreaterThan(0);
  });

  it("flaggt Kurzsegmente unter dem Schwellwert", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 800, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    expect(out[0].flagged).toBe(true);
    expect(out[1].flagged).toBe(false);
  });

  it("ignoriert Events mit unbekannter tabId und Wechsel nach Aufnahme-Ende", () => {
    const tabs = [tab("a", textSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "tabSwitch", tabId: "ghost" },
      { t: 11_000, type: "tabSwitch", tabId: "a" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    expect(out).toHaveLength(1);
    expect(out[0].segment.durationMs).toBe(10_000);
  });

  it("liefert leere Liste bei fehlenden Tabs oder Dauer 0", () => {
    expect(deriveStudioSegments([], [], 5000)).toEqual([]);
    expect(
      deriveStudioSegments([tab("a", textSegment("s"))], [], 0),
    ).toEqual([]);
  });

  it("fällt bei recordedMs 0 auf die gültige Server-Dauer zurück", () => {
    // Client-Uhr versagt (onstop ohne stop(), z. B. Track endet) — die
    // ffprobe-Dauer ist trotzdem da: Aufnahme darf nicht verloren gehen.
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 0, { totalMs: 10_000 });
    expect(out).toHaveLength(2);
    expect(sumDurations(out)).toBe(10_000);
    expect(out[0].segment.durationMs).toBe(4000);
    expect(out[1].segment.durationMs).toBe(6000);
  });
});

describe("removeDerivedSegment", () => {
  function derived(): ReturnType<typeof deriveStudioSegments> {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
      tab("c", textSegment("seg-c")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 3000, type: "scroll", tabId: "a", y: 0.5 },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 5000, type: "tabSwitch", tabId: "c" },
    ];
    return deriveStudioSegments(tabs, events, 12_000);
  }

  it("gibt die Dauer an den Vorgänger und berechnet startMs neu", () => {
    const list = derived();
    const out = removeDerivedSegment(list, 1);
    expect(out).toHaveLength(2);
    expect(out[0].segment.durationMs).toBe(5000);
    expect(out[1].startMs).toBe(5000);
    expect(sumDurations(out)).toBe(12_000);
  });

  it("gibt beim ersten Segment die Dauer an den Nachfolger und verschiebt dessen Frames", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "tabSwitch", tabId: "b" },
      { t: 3000, type: "scroll", tabId: "b", y: 1 },
    ];
    const list = deriveStudioSegments(tabs, events, 10_000);
    const out = removeDerivedSegment(list, 0);
    expect(out).toHaveLength(1);
    expect(out[0].segment.durationMs).toBe(10_000);
    expect(out[0].startMs).toBe(0);
    expect((out[0].segment as WebsiteSegment).scrollFrames).toEqual([
      { t: 2000, y: 0 },
      { t: 3000, y: 1 },
    ]);
  });

  it("entflaggt den Empfänger, wenn er durch den Merge lang genug wird", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", textSegment("seg-b")),
      tab("c", textSegment("seg-c")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "tabSwitch", tabId: "b" },
      { t: 1800, type: "tabSwitch", tabId: "c" },
    ];
    const list = deriveStudioSegments(tabs, events, 10_000);
    expect(list[0].flagged).toBe(true);
    const out = removeDerivedSegment(list, 1);
    expect(out[0].segment.durationMs).toBe(1800);
    expect(out[0].flagged).toBe(false);
  });

  it("verändert die Eingabeliste nicht und behandelt Randfälle", () => {
    const list = derived();
    const before = JSON.stringify(list);
    removeDerivedSegment(list, 1);
    expect(JSON.stringify(list)).toBe(before);
    expect(removeDerivedSegment(list, -1)).toBe(list);
    expect(removeDerivedSegment(list, 99)).toBe(list);
    expect(removeDerivedSegment([list[0]], 0)).toEqual([]);
  });
});
