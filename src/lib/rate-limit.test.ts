import { describe, expect, it, beforeEach } from "vitest";

describe("rate-limit in-memory fallback (kein REDIS_URL)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  it("zaehlt pro Key und sperrt ab max+1", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    const key = `test:${Math.random()}`;
    const r1 = await checkRateLimit(key, 2, 60);
    const r2 = await checkRateLimit(key, 2, 60);
    const r3 = await checkRateLimit(key, 2, 60);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    expect(r3.count).toBe(3);
    expect(r3.ttl).toBeGreaterThan(0);
  });

  it("verschiedene Keys beeinflussen sich nicht", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    await checkRateLimit(a, 1, 60);
    expect((await checkRateLimit(a, 1, 60)).ok).toBe(false);
    expect((await checkRateLimit(b, 1, 60)).ok).toBe(true);
  });
});
