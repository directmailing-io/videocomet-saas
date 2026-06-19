/**
 * Tests für `src/lib/crm/crypto.ts`. Stellt sicher, dass Roundtrip
 * funktioniert, der Hint nur die letzten 4 Zeichen leakt und ein
 * fehlendes/zu kurzes Secret deterministisch fliegt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiKeyHint, assertCrmSecret, decryptApiKey, encryptApiKey } from "@/lib/crm/crypto";

const VALID_SECRET = "a".repeat(64);

describe("crm/crypto", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.CRM_KEY_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRM_KEY_SECRET;
    } else {
      process.env.CRM_KEY_SECRET = originalSecret;
    }
  });

  it("roundtrip: encryptApiKey → decryptApiKey gibt Originalwert zurück", () => {
    process.env.CRM_KEY_SECRET = VALID_SECRET;
    const plain = "pat-na1-very-secret-1234567890";
    const enc = encryptApiKey(plain);
    expect(enc.split(":")).toHaveLength(3);
    expect(decryptApiKey(enc)).toBe(plain);
  });

  it("encryptApiKey: zwei Aufrufe ergeben unterschiedliche Ciphertexte (random IV)", () => {
    process.env.CRM_KEY_SECRET = VALID_SECRET;
    const a = encryptApiKey("same-input");
    const b = encryptApiKey("same-input");
    expect(a).not.toBe(b);
  });

  it("apiKeyHint: liefert die letzten 4 Zeichen", () => {
    expect(apiKeyHint("abcdef1234")).toBe("1234");
  });

  it("apiKeyHint: kürzer als 4 → komplett zurückgegeben", () => {
    expect(apiKeyHint("ab")).toBe("ab");
  });

  it("assertCrmSecret: wirft, wenn das Secret fehlt", () => {
    delete process.env.CRM_KEY_SECRET;
    expect(() => assertCrmSecret()).toThrow(/CRM_KEY_SECRET/);
  });

  it("assertCrmSecret: wirft bei falscher Länge", () => {
    process.env.CRM_KEY_SECRET = "deadbeef";
    expect(() => assertCrmSecret()).toThrow(/hex/i);
  });

  it("decryptApiKey: wirft bei tampered ciphertext (GCM-Auth-Tag schlägt fehl)", () => {
    process.env.CRM_KEY_SECRET = VALID_SECRET;
    const enc = encryptApiKey("hello");
    const parts = enc.split(":");
    // Letztes Zeichen des Ciphertexts kippen
    const tampered = Buffer.from(parts[2]!, "base64");
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    const broken = `${parts[0]}:${parts[1]}:${tampered.toString("base64")}`;
    expect(() => decryptApiKey(broken)).toThrow();
  });

  it("decryptApiKey: wirft bei malformed payload", () => {
    process.env.CRM_KEY_SECRET = VALID_SECRET;
    expect(() => decryptApiKey("not-a-valid-format")).toThrow(/malformed/);
  });
});
