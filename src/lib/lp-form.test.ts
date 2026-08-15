import { describe, expect, it } from "vitest";
import { parseLpFormSubmission } from "./lp-form";

const LEAD_ID = "0b7b3d6e-4c2a-4f6f-9a1e-2d3c4b5a6f70";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    leadId: LEAD_ID,
    name: "Max Mustermann",
    email: "max@example.com",
    phone: "+49 170 1234567",
    message: "Bitte ruf mich zurück.",
    ...overrides,
  };
}

describe("parseLpFormSubmission", () => {
  it("akzeptiert einen vollständigen, gültigen Body", () => {
    const res = parseLpFormSubmission(validBody());
    expect(res.ok).toBe(true);
    if (!res.ok || res.honeypot) throw new Error("expected value result");
    expect(res.value).toEqual({
      leadId: LEAD_ID,
      name: "Max Mustermann",
      email: "max@example.com",
      phone: "+49 170 1234567",
      message: "Bitte ruf mich zurück.",
      extra: [],
    });
  });

  it("übernimmt Zusatzfelder (extra) getrimmt und gekappt", () => {
    const res = parseLpFormSubmission(
      validBody({
        extra: [
          { label: " Firma ", value: " ACME GmbH " },
          { label: "Leer", value: "   " },
          { label: "", value: "ohne Label" },
          "kaputt",
          { label: "L".repeat(200), value: "V".repeat(2000) },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok || res.honeypot) throw new Error("expected value result");
    expect(res.value.extra).toEqual([
      { label: "Firma", value: "ACME GmbH" },
      { label: "L".repeat(80), value: "V".repeat(1000) },
    ]);
  });

  it("lehnt extra ab, wenn es kein Array ist", () => {
    const res = parseLpFormSubmission(validBody({ extra: "nope" }));
    expect(res.ok).toBe(false);
  });

  it("akzeptiert einen minimalen Body ohne phone/message", () => {
    const res = parseLpFormSubmission({
      leadId: LEAD_ID,
      name: "  Max  ",
      email: " max@example.com ",
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.honeypot) throw new Error("expected value result");
    expect(res.value.name).toBe("Max");
    expect(res.value.email).toBe("max@example.com");
    expect(res.value.phone).toBeNull();
    expect(res.value.message).toBeNull();
  });

  it("behandelt leere optionale Strings wie nicht gesetzt", () => {
    const res = parseLpFormSubmission(validBody({ phone: "  ", message: "" }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.honeypot) throw new Error("expected value result");
    expect(res.value.phone).toBeNull();
    expect(res.value.message).toBeNull();
  });

  it("erkennt den Honeypot und meldet honeypot:true (auch bei sonst kaputtem Body)", () => {
    const res = parseLpFormSubmission({ website: "https://spam.example" });
    expect(res).toEqual({ ok: true, honeypot: true });
  });

  it("ignoriert einen leeren Honeypot-Wert", () => {
    const res = parseLpFormSubmission(validBody({ website: "  " }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.honeypot) throw new Error("expected value result");
    expect(res.value.leadId).toBe(LEAD_ID);
  });

  it("lehnt Nicht-Objekt-Bodies ab", () => {
    for (const bad of [null, undefined, "x", 42, ["a"]]) {
      const res = parseLpFormSubmission(bad);
      expect(res.ok).toBe(false);
    }
  });

  it("lehnt eine leadId ab, die kein UUID ist", () => {
    for (const bad of ["", "abc", "0b7b3d6e4c2a4f6f9a1e2d3c4b5a6f70", 123]) {
      const res = parseLpFormSubmission(validBody({ leadId: bad }));
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      // Sicherheit: keine Reflection der Eingabe in der Fehlermeldung.
      const s = String(bad);
      if (s.length > 0) expect(res.error).not.toContain(s);
    }
  });

  it("lehnt fehlenden oder leeren Namen ab", () => {
    for (const bad of [undefined, "", "   ", 7]) {
      const res = parseLpFormSubmission(validBody({ name: bad }));
      expect(res.ok).toBe(false);
    }
  });

  it("lehnt überlangen Namen ab (max 120)", () => {
    const res = parseLpFormSubmission(validBody({ name: "x".repeat(121) }));
    expect(res.ok).toBe(false);
    const ok = parseLpFormSubmission(validBody({ name: "x".repeat(120) }));
    expect(ok.ok).toBe(true);
  });

  it("lehnt kaputte oder überlange E-Mails ab", () => {
    for (const bad of [
      undefined,
      "",
      "keine-mail",
      "a@b",
      "a b@c.de",
      `${"x".repeat(195)}@ex.com`,
    ]) {
      const res = parseLpFormSubmission(validBody({ email: bad }));
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error).toBe("Bitte gib eine gültige E-Mail-Adresse an.");
    }
  });

  it("lehnt überlange Telefonnummer ab (max 50)", () => {
    const res = parseLpFormSubmission(validBody({ phone: "1".repeat(51) }));
    expect(res.ok).toBe(false);
  });

  it("lehnt überlange Nachricht ab (max 2000)", () => {
    const res = parseLpFormSubmission(validBody({ message: "x".repeat(2001) }));
    expect(res.ok).toBe(false);
    const ok = parseLpFormSubmission(validBody({ message: "x".repeat(2000) }));
    expect(ok.ok).toBe(true);
  });

  it("formuliert Fehlermeldungen in Du-Form ohne em-Dash", () => {
    const cases = [
      parseLpFormSubmission(null),
      parseLpFormSubmission(validBody({ leadId: "nope" })),
      parseLpFormSubmission(validBody({ name: "" })),
      parseLpFormSubmission(validBody({ email: "nope" })),
      parseLpFormSubmission(validBody({ phone: "1".repeat(51) })),
      parseLpFormSubmission(validBody({ message: "x".repeat(2001) })),
    ];
    for (const res of cases) {
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.length).toBeGreaterThan(0);
      expect(res.error).not.toContain("—");
    }
  });
});
