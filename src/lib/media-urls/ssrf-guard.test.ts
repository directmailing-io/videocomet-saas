import { describe, expect, it } from "vitest";
import { assertUrlIsSafe, SsrfBlockedError } from "./ssrf-guard";

describe("ssrf-guard", () => {
  const blocked = [
    "http://169.254.169.254/hetzner/v1/metadata",
    "http://10.0.0.2:5432/",
    "http://172.18.0.5/",
    "http://192.168.1.1/",
    "http://127.0.0.1:3000/",
    "http://100.64.1.1/",
    "http://[::1]/",
    "http://[::ffff:10.0.0.2]/",
    "http://[fd00::1]/",
    "http://localhost/",
    "file:///etc/passwd",
    "gopher://example.com/",
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, async () => {
      await expect(assertUrlIsSafe(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  }

  it("allows public IP literals", async () => {
    await expect(assertUrlIsSafe("https://1.1.1.1/")).resolves.toBeUndefined();
  });
});
