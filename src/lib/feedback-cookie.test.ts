import { beforeAll, describe, expect, it } from "vitest";
import {
  reviewCookieName,
  signReviewCookie,
  verifyReviewCookie,
} from "./feedback-cookie";

beforeAll(() => {
  // 32-Byte-Hex-Secret setzen, damit requireShareCookieSecret nicht wirft.
  process.env.SHARE_COOKIE_SECRET =
    process.env.SHARE_COOKIE_SECRET ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("feedback-cookie", () => {
  it("cookieName benutzt die ersten 8 URL-safe-Zeichen als Suffix", () => {
    expect(reviewCookieName("abcdefghXYZ12345")).toBe("vc_review_abcdefgh");
    // slice(0,8) auf "aa$bb--cc" = "aa$bb--c" → non-alnum entfernt = "aabbc"
    expect(reviewCookieName("aa$bb--cc")).toBe("vc_review_aabbc");
  });

  it("sign & verify — happy path", () => {
    const s = signReviewCookie("tokenxyz1234567", 3600);
    expect(s.name).toBe("vc_review_tokenxyz");
    expect(s.path).toBe("/review/tokenxyz1234567");
    expect(verifyReviewCookie("tokenxyz1234567", s.value)).toBe(true);
  });

  it("verify lehnt ab bei Token-Mismatch", () => {
    const s = signReviewCookie("token-a", 3600);
    expect(verifyReviewCookie("token-b", s.value)).toBe(false);
  });

  it("verify lehnt ab bei manipuliertem HMAC", () => {
    const s = signReviewCookie("token-x", 3600);
    const parts = s.value.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"0".repeat(parts[2].length)}`;
    expect(verifyReviewCookie("token-x", tampered)).toBe(false);
  });

  it("verify lehnt ab bei manipulierter Exp", () => {
    const s = signReviewCookie("token-x", 3600);
    const [t, , mac] = s.value.split(".");
    const forged = `${t}.9999999999.${mac}`;
    expect(verifyReviewCookie("token-x", forged)).toBe(false);
  });

  it("verify lehnt ab bei abgelaufenem Cookie", () => {
    // TTL -60 s → sofort abgelaufen. signReviewCookie rechnet exp = now+ttl.
    const s = signReviewCookie("token-x", -60);
    expect(verifyReviewCookie("token-x", s.value)).toBe(false);
  });

  it("verify lehnt ab bei komplett kaputtem Wert", () => {
    expect(verifyReviewCookie("t", "")).toBe(false);
    expect(verifyReviewCookie("t", null)).toBe(false);
    expect(verifyReviewCookie("t", undefined)).toBe(false);
    expect(verifyReviewCookie("t", "not-three-parts")).toBe(false);
    expect(verifyReviewCookie("t", "a.b")).toBe(false);
  });
});
