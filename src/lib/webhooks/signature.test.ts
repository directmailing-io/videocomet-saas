/**
 * Tests für `src/lib/webhooks/signature.ts`. Deckt sign/verify-Roundtrip,
 * Replay-Window, Bad-Secret, Tampered-Body und Malformed-Header ab.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { signRawBody, verifySignature } from "@/lib/webhooks/signature";

const SECRET = "whsec_test_topsecret_abcdef0123456789";

describe("webhooks/signature", () => {
  const FIXED_MS = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sign+verify Roundtrip mit Default-`now`", () => {
    const body = `{"id":"evt_x","kind":"lead.opened"}`;
    const { header } = signRawBody(SECRET, body);
    expect(verifySignature(SECRET, body, header)).toBe(true);
  });

  it("Header-Form: `t=<digits>,v1=<hex>`", () => {
    const { header, t, v1 } = signRawBody(SECRET, "hi");
    expect(header).toBe(`t=${t},v1=${v1}`);
    expect(t).toBe(Math.floor(FIXED_MS / 1000));
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Replay-Window: > 5 min in der Vergangenheit wird verworfen", () => {
    const body = "payload";
    const tOld = Math.floor(FIXED_MS / 1000) - 301; // 5min1sec alt
    const { header } = signRawBody(SECRET, body, tOld);
    expect(verifySignature(SECRET, body, header)).toBe(false);
  });

  it("Replay-Window: < 5 min ist erlaubt", () => {
    const body = "payload";
    const tOld = Math.floor(FIXED_MS / 1000) - 299;
    const { header } = signRawBody(SECRET, body, tOld);
    expect(verifySignature(SECRET, body, header)).toBe(true);
  });

  it("Bad-Secret: andere Secrets verifizieren nicht", () => {
    const body = "x";
    const { header } = signRawBody(SECRET, body);
    expect(verifySignature("whsec_other", body, header)).toBe(false);
  });

  it("Tampered-Body: einzelnes Zeichen geändert → false", () => {
    const body = `{"a":1}`;
    const { header } = signRawBody(SECRET, body);
    expect(verifySignature(SECRET, `{"a":2}`, header)).toBe(false);
  });

  it("Malformed-Header: fehlende v1 → false", () => {
    expect(verifySignature(SECRET, "x", "t=123")).toBe(false);
  });

  it("Malformed-Header: nicht-numerisches t → false", () => {
    expect(verifySignature(SECRET, "x", "t=abc,v1=00")).toBe(false);
  });

  it("Custom Toleranz via opts.toleranceSec", () => {
    const body = "y";
    const tOld = Math.floor(FIXED_MS / 1000) - 60;
    const { header } = signRawBody(SECRET, body, tOld);
    expect(verifySignature(SECRET, body, header, { toleranceSec: 30 })).toBe(
      false,
    );
    expect(verifySignature(SECRET, body, header, { toleranceSec: 120 })).toBe(
      true,
    );
  });
});
