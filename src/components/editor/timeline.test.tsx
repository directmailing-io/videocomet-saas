import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { Timeline } from "./timeline";
import type { Segment, TextSegment } from "@/lib/segments/types";

function textSeg(id: string, durationMs: number): TextSegment {
  return {
    id,
    kind: "text",
    durationMs,
    text: "Hallo",
    bgColor: "#ffffff",
    textColor: "#000000",
    fontSize: 32,
    textAlign: "center",
    fontWeight: "600",
    italic: false,
  };
}

function renderTimeline(overrides?: Partial<React.ComponentProps<typeof Timeline>>) {
  const segments: Segment[] = [textSeg("a", 5_000), textSeg("b", 10_000)];
  const onSegmentsChange = vi.fn();
  const utils = render(
    <Timeline
      segments={segments}
      currentTimeMs={0}
      selectedSegmentId={null}
      onSelectSegment={() => {}}
      onSegmentsChange={onSegmentsChange}
      onSeek={() => {}}
      {...overrides}
    />,
  );
  return { ...utils, onSegmentsChange };
}

beforeAll(() => {
  // jsdom kennt weder ResizeObserver noch Pointer-Capture.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => cleanup());

describe("Timeline Zoom", () => {
  it("startet im Fit-Modus (ganze Timeline ohne Scrollen)", () => {
    renderTimeline();
    const fitButton = screen.getByRole("button", { name: "Alles anzeigen" });
    expect(fitButton).toHaveAttribute("aria-pressed", "true");
    // Im Fit-Modus gibt es nichts weiter rauszuzoomen.
    expect(screen.getByRole("button", { name: "Weniger Zoom" })).toBeDisabled();
  });

  it("Reinzoomen verlässt Fit, 'Alles anzeigen' kehrt zurück", () => {
    renderTimeline();
    fireEvent.click(screen.getByRole("button", { name: "Mehr Zoom" }));
    const fitButton = screen.getByRole("button", { name: "Alles anzeigen" });
    expect(fitButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Weniger Zoom" })).toBeEnabled();
    fireEvent.click(fitButton);
    expect(fitButton).toHaveAttribute("aria-pressed", "true");
  });

  it("Slider auf Maximum zoomt rein, auf Minimum rastet auf Fit", () => {
    renderTimeline();
    const slider = screen.getByRole("slider", { name: "Zoom-Stufe" });
    fireEvent.change(slider, { target: { value: "100" } });
    expect(
      screen.getByRole("button", { name: "Alles anzeigen" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(
      screen.getByRole("button", { name: "Alles anzeigen" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Timeline Trim & Roll", () => {
  it("erstes Segment hat keinen Roll-Handle, folgende schon", () => {
    renderTimeline();
    const rollHandles = screen.getAllByRole("separator", {
      name: "Übergang zum vorigen Segment verschieben",
    });
    expect(rollHandles).toHaveLength(1);
  });

  it("Alt+Pfeil rechts verlängert das Segment um 100ms", () => {
    const { onSegmentsChange } = renderTimeline();
    const block = screen.getByRole("button", { name: /Text: Text, 5\.0 Sekunden/ });
    fireEvent.keyDown(block, { key: "ArrowRight", altKey: true });
    expect(onSegmentsChange).toHaveBeenCalledTimes(1);
    const next = onSegmentsChange.mock.calls[0][0] as Segment[];
    expect(next.map((s) => s.durationMs)).toEqual([5_100, 10_000]);
  });

  it("Alt+Pfeil respektiert das Webcam-Limit", () => {
    const { onSegmentsChange } = renderTimeline({ webcamDurationMs: 15_000 });
    const block = screen.getByRole("button", { name: /Text: Text, 5\.0 Sekunden/ });
    fireEvent.keyDown(block, { key: "ArrowRight", altKey: true });
    // 5000 + 10000 == 15000 → Limit erreicht, keine Änderung.
    expect(onSegmentsChange).not.toHaveBeenCalled();
  });

  it("Roll-Edit verschiebt die Grenze: eines länger, das andere kürzer", () => {
    const { onSegmentsChange } = renderTimeline();
    const [rollHandle] = screen.getAllByRole("separator", {
      name: "Übergang zum vorigen Segment verschieben",
    });
    fireEvent.pointerDown(rollHandle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(rollHandle, { clientX: 150, pointerId: 1 });
    expect(onSegmentsChange).toHaveBeenCalledTimes(1);
    const next = onSegmentsChange.mock.calls[0][0] as Segment[];
    // Delta positiv → voriges länger, dieses kürzer, Summe konstant.
    const [a, b] = next.map((s) => s.durationMs);
    expect(a + b).toBe(15_000);
    expect(a).toBeGreaterThan(5_000);
    expect(b).toBeLessThan(10_000);
  });

  it("Roll-Edit unterschreitet nie 200ms pro Segment", () => {
    const { onSegmentsChange } = renderTimeline();
    const [rollHandle] = screen.getAllByRole("separator", {
      name: "Übergang zum vorigen Segment verschieben",
    });
    // Extrem weit nach links ziehen — voriges Segment darf nur bis 200ms schrumpfen.
    fireEvent.pointerDown(rollHandle, { clientX: 100_000, pointerId: 1 });
    fireEvent.pointerUp(rollHandle, { clientX: 0, pointerId: 1 });
    expect(onSegmentsChange).toHaveBeenCalledTimes(1);
    const next = onSegmentsChange.mock.calls[0][0] as Segment[];
    expect(next.map((s) => s.durationMs)).toEqual([200, 14_800]);
  });
});
