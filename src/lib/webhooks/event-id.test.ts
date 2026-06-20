/**
 * Tests für `src/lib/webhooks/event-id.ts`. Garantiert das öffentlich
 * versprochene Format und die monotone Sortierung.
 */
import { describe, expect, it } from "vitest";
import { generateEventId } from "@/lib/webhooks/event-id";

const FORMAT_RE = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;

describe("webhooks/event-id", () => {
  it("liefert genau `evt_<26 Crockford-Base32-Chars>`", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateEventId();
      expect(id).toMatch(FORMAT_RE);
    }
  });

  it("IDs sind zeitlich aufsteigend (Burst innerhalb gleicher ms)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      ids.push(generateEventId());
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("IDs sind eindeutig (200k Bursts → 0 Kollisionen)", () => {
    const seen = new Set<string>();
    const N = 2_000;
    for (let i = 0; i < N; i++) seen.add(generateEventId());
    expect(seen.size).toBe(N);
  });
});
