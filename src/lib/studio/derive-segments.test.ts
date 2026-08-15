import { describe, expect, it } from "vitest";
import type {
  Segment,
  TextSegment,
  VideoSegment,
  WebsiteSegment,
} from "@/lib/segments/types";
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

function videoSegment(id: string): VideoSegment {
  return {
    id,
    kind: "video",
    durationMs: 5000,
    mediaId: "media-1",
    publicUrl: "https://cdn.example.com/abc/playlist.m3u8",
    originalDurationSec: 60,
    trimStartMs: 0,
    trimEndMs: null,
    cropRatio: "16:9",
    showAsBrowserFrame: false,
    browserTabName: "",
    browserTabUrl: "",
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

describe("deriveStudioSegments — Cursor-Frames", () => {
  it("renormiert Cursor-Events auf den Segment-Start ohne automatisches t=0-Sample", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 5000, type: "cursor", tabId: "b", x: 0.3, y: 0.4 },
      { t: 6000, type: "cursor", tabId: "b", x: 0.6, y: 0.8 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[1].segment as WebsiteSegment;
    // Kein Sample bei t=0: Cursor bleibt unsichtbar bis zur ersten Bewegung.
    expect(seg.cursorFrames).toEqual([
      { t: 1000, x: 0.3, y: 0.4 },
      { t: 2000, x: 0.6, y: 0.8 },
    ]);
  });

  it("klemmt Cursor-Koordinaten auf 0..1", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "cursor", tabId: "a", x: 1.2, y: -0.3 },
    ];
    const out = deriveStudioSegments(tabs, events, 5000);
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.cursorFrames).toEqual([{ t: 1000, x: 1, y: 0 }]);
  });

  it("übernimmt ein Boundary-Sample kurz vor Segment-Start als Seed bei t=0", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      // Force-Flush beim Tab-Wechsel legt das Sample direkt vor die Grenze.
      { t: 3999, type: "cursor", tabId: "a", x: 0.5, y: 0.5 },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 6000, type: "cursor", tabId: "b", x: 0.7, y: 0.2 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[1].segment as WebsiteSegment;
    expect(seg.cursorFrames).toEqual([
      { t: 0, x: 0.5, y: 0.5 },
      { t: 2000, x: 0.7, y: 0.2 },
    ]);
  });

  it("setzt keinen Seed, wenn das letzte Sample zu alt ist", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      // 300 ms vor der Grenze: Maus hat die Bühne verlassen → kein Ghost-Cursor.
      { t: 3700, type: "cursor", tabId: "a", x: 0.5, y: 0.5 },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 6000, type: "cursor", tabId: "b", x: 0.7, y: 0.2 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[1].segment as WebsiteSegment;
    expect(seg.cursorFrames).toEqual([{ t: 2000, x: 0.7, y: 0.2 }]);
  });

  it("skaliert die Cursor-Zeiten bei proportionaler Skalierung mit", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 5000, type: "cursor", tabId: "a", x: 0.4, y: 0.6 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 20_000 });
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.cursorFrames).toEqual([{ t: 10_000, x: 0.4, y: 0.6 }]);
  });

  it("hängt keine Cursor-Frames an nicht scrollbare Segmente", () => {
    const tabs = [tab("a", textSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "cursor", tabId: "a", x: 0.5, y: 0.5 },
    ];
    const out = deriveStudioSegments(tabs, events, 5000);
    expect("cursorFrames" in out[0].segment).toBe(false);
  });

  it("ignoriert Cursor-Events außerhalb des Segment-Fensters", () => {
    const tabs = [
      tab("a", websiteSegment("seg-a")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "cursor", tabId: "a", x: 0.1, y: 0.1 },
      { t: 4000, type: "tabSwitch", tabId: "b" },
      { t: 5000, type: "cursor", tabId: "a", x: 0.9, y: 0.9 },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[0].segment as WebsiteSegment;
    expect(seg.cursorFrames).toEqual([{ t: 1000, x: 0.1, y: 0.1 }]);
  });
});

describe("deriveStudioSegments — Video-Wiedergabefenster", () => {
  it("leitet Play/Pause-Paare als Fenster relativ zum Segment-Start ab", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("v", videoSegment("seg-v")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 4000, type: "tabSwitch", tabId: "v" },
      { t: 5000, type: "mediaPlay", tabId: "v" },
      { t: 8000, type: "mediaPause", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 12_000);
    const seg = out[1].segment as VideoSegment;
    expect(seg.playbackWindows).toEqual([{ startMs: 1000, stopMs: 4000 }]);
    expect(seg.trimStartMs).toBe(0);
  });

  it("schließt ein offenes Fenster am Segment-Ende (Szenenwechsel pausiert implizit)", () => {
    const tabs = [
      tab("v", videoSegment("seg-v")),
      tab("b", textSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 2000, type: "mediaPlay", tabId: "v" },
      { t: 6000, type: "tabSwitch", tabId: "b" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toEqual([{ startMs: 2000, stopMs: 6000 }]);
  });

  it("schließt ein bis zum Aufnahme-Ende offenes Fenster bei durationMs", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 3000, type: "mediaPlay", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 9000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toEqual([{ startMs: 3000, stopMs: 9000 }]);
  });

  it("unterstützt mehrere Fenster in einem Segment", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 1000, type: "mediaPlay", tabId: "v" },
      { t: 3000, type: "mediaPause", tabId: "v" },
      { t: 5000, type: "mediaPlay", tabId: "v" },
      { t: 7000, type: "mediaPause", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toEqual([
      { startMs: 1000, stopMs: 3000 },
      { startMs: 5000, stopMs: 7000 },
    ]);
  });

  it("akkumuliert die abgespielte Zeit über Besuche in trimStartMs", () => {
    const draft = videoSegment("seg-v");
    draft.trimStartMs = 500;
    const tabs = [tab("v", draft), tab("b", textSegment("seg-b"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 1000, type: "mediaPlay", tabId: "v" },
      { t: 4000, type: "mediaPause", tabId: "v" },
      { t: 6000, type: "tabSwitch", tabId: "b" },
      { t: 8000, type: "tabSwitch", tabId: "v" },
      { t: 9000, type: "mediaPlay", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 12_000);
    expect(out).toHaveLength(3);
    const first = out[0].segment as VideoSegment;
    const revisit = out[2].segment as VideoSegment;
    // Erster Besuch: Basis-Trim bleibt, 3 s gespielt.
    expect(first.trimStartMs).toBe(500);
    expect(first.playbackWindows).toEqual([{ startMs: 1000, stopMs: 4000 }]);
    // Zweiter Besuch: setzt bei 500 + 3000 ms im Quellvideo fort.
    expect(revisit.trimStartMs).toBe(3500);
    expect(revisit.playbackWindows).toEqual([{ startMs: 1000, stopMs: 4000 }]);
  });

  it("bleibt ohne Play-Events beim Poster-Standbild (keine Fenster)", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [{ t: 0, type: "tabSwitch", tabId: "v" }];
    const out = deriveStudioSegments(tabs, events, 8000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toBeUndefined();
  });

  it("ignoriert doppelte Play-Events und Pause ohne vorheriges Play", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 500, type: "mediaPause", tabId: "v" },
      { t: 1000, type: "mediaPlay", tabId: "v" },
      { t: 2000, type: "mediaPlay", tabId: "v" },
      { t: 3000, type: "mediaPause", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 8000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toEqual([{ startMs: 1000, stopMs: 3000 }]);
  });

  it("verwirft Null-Längen-Fenster (Play+Pause im selben Moment)", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 2000, type: "mediaPlay", tabId: "v" },
      { t: 2000, type: "mediaPause", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 8000);
    const seg = out[0].segment as VideoSegment;
    expect(seg.playbackWindows).toBeUndefined();
    expect(seg.trimStartMs).toBe(0);
  });

  it("skaliert Fenster-Zeiten proportional mit", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 2000, type: "mediaPlay", tabId: "v" },
      { t: 4000, type: "mediaPause", tabId: "v" },
    ];
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 20_000 });
    const seg = out[0].segment as VideoSegment;
    expect(seg.durationMs).toBe(20_000);
    expect(seg.playbackWindows).toEqual([{ startMs: 4000, stopMs: 8000 }]);
  });

  it("klemmt Fenster bei negativem lastAdjust auf das Segment-Ende", () => {
    const tabs = [tab("v", videoSegment("seg-v"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "v" },
      { t: 9900, type: "mediaPlay", tabId: "v" },
    ];
    // totalMs 9500 → lastAdjust -500 → durationMs 9500 < Play-Zeitpunkt 9900.
    const out = deriveStudioSegments(tabs, events, 10_000, { totalMs: 9500 });
    const seg = out[0].segment as VideoSegment;
    expect(seg.durationMs).toBe(9500);
    expect(seg.playbackWindows).toBeUndefined();
  });

  it("lässt Nicht-Video-Segmente von Media-Events unberührt", () => {
    const tabs = [tab("a", websiteSegment("seg-a"))];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 1000, type: "mediaPlay", tabId: "a" },
      { t: 2000, type: "mediaPause", tabId: "a" },
    ];
    const out = deriveStudioSegments(tabs, events, 8000);
    const seg = out[0].segment;
    expect("playbackWindows" in seg).toBe(false);
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

  it("verschiebt beim ersten Segment auch Cursor-Frames nach hinten", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("b", websiteSegment("seg-b")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "tabSwitch", tabId: "b" },
      { t: 3000, type: "cursor", tabId: "b", x: 0.5, y: 0.5 },
    ];
    const list = deriveStudioSegments(tabs, events, 10_000);
    const out = removeDerivedSegment(list, 0);
    expect(out).toHaveLength(1);
    expect((out[0].segment as WebsiteSegment).cursorFrames).toEqual([
      { t: 3000, x: 0.5, y: 0.5 },
    ]);
  });

  it("verschiebt beim ersten Segment auch Video-Wiedergabefenster nach hinten", () => {
    const tabs = [
      tab("a", textSegment("seg-a")),
      tab("v", videoSegment("seg-v")),
    ];
    const events: StudioEvent[] = [
      { t: 0, type: "tabSwitch", tabId: "a" },
      { t: 2000, type: "tabSwitch", tabId: "v" },
      { t: 3000, type: "mediaPlay", tabId: "v" },
      { t: 5000, type: "mediaPause", tabId: "v" },
    ];
    const list = deriveStudioSegments(tabs, events, 10_000);
    const out = removeDerivedSegment(list, 0);
    expect(out).toHaveLength(1);
    const seg = out[0].segment as VideoSegment;
    expect(seg.durationMs).toBe(10_000);
    expect(seg.playbackWindows).toEqual([{ startMs: 3000, stopMs: 5000 }]);
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
