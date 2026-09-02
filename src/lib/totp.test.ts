import { describe, expect, it, beforeAll } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  signShortToken,
  totpCode,
  verifyShortToken,
  verifyTotp,
} from "./totp";

// RFC 6238 Test-Vektor: Secret "12345678901234567890" (ASCII), SHA-1.
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  beforeAll(() => {
    process.env.COOKIE_SECRET = "unit-test-cookie-secret-32-chars-long!!";
  });

  it("base32 round-trip", () => {
    const buf = Buffer.from("12345678901234567890", "ascii");
    expect(base32Encode(buf)).toBe(RFC_SECRET_B32);
    expect(base32Decode(RFC_SECRET_B32).equals(buf)).toBe(true);
  });

  it("matches RFC 6238 vectors (SHA-1, 6 digits)", () => {
    // Zeitpunkte aus dem RFC-Anhang: T=59 → 287082 (8-stellig 94287082)
    expect(totpCode(RFC_SECRET_B32, 59 * 1000)).toBe("287082");
    expect(totpCode(RFC_SECRET_B32, 1111111109 * 1000)).toBe("081804");
    expect(totpCode(RFC_SECRET_B32, 1234567890 * 1000)).toBe("005924");
  });

  it("verifies with ±1 window and rejects garbage", () => {
    const at = 1111111109 * 1000;
    expect(verifyTotp(RFC_SECRET_B32, "081804", at)).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, "081 804", at)).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, "081804", at + 30_000)).toBe(true); // vorheriges Fenster
    expect(verifyTotp(RFC_SECRET_B32, "081804", at + 90_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "abcdef", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "", at)).toBe(false);
  });

  it("encrypts and decrypts the secret", () => {
    const enc = encryptTotpSecret(RFC_SECRET_B32);
    expect(enc).not.toContain(RFC_SECRET_B32);
    expect(decryptTotpSecret(enc)).toBe(RFC_SECRET_B32);
  });

  it("short tokens: purpose-bound, expiring, tamper-proof", () => {
    const t = signShortToken({ uid: "u1" }, 60, "mfa-login");
    expect(verifyShortToken<{ uid: string }>(t, "mfa-login")?.uid).toBe("u1");
    expect(verifyShortToken(t, "totp-setup")).toBeNull();
    const [body, mac] = t.split(".");
    expect(verifyShortToken(`${body}x.${mac}`, "mfa-login")).toBeNull();
    const expired = signShortToken({ uid: "u1" }, -1, "mfa-login");
    expect(verifyShortToken(expired, "mfa-login")).toBeNull();
  });
});
