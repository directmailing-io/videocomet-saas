import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeUrl } from "./url-probe";

vi.mock("node:dns", () => ({
  default: {
    promises: {
      resolve4: vi.fn(async () => ["93.184.216.34"]),
    },
  },
}));

function connErr(code: string): Error {
  const err = new Error(code) as Error & { cause?: { code: string } };
  err.cause = { code };
  return err;
}

const okResponse = () =>
  new Response(null, { status: 200, headers: { server: "nginx" } });

describe("probeUrl — http-Fallback für schemalose URLs", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fällt bei TLS-Fehler auf http:// zurück, wenn kein Schema angegeben war", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://")) {
        throw connErr("CERT_HAS_EXPIRED");
      }
      return okResponse();
    });

    const res = await probeUrl("alte-firma.de");
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toMatch(/^http:\/\/alte-firma\.de/);
  });

  it("fällt bei Verbindungsfehler (ECONNREFUSED) auf http:// zurück", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://")) {
        throw connErr("ECONNREFUSED");
      }
      return okResponse();
    });

    const res = await probeUrl("firma.de");
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toMatch(/^http:\/\//);
  });

  it("macht KEINEN Fallback bei explizitem https-Schema", async () => {
    fetchMock.mockImplementation(async () => {
      throw connErr("CERT_HAS_EXPIRED");
    });

    const res = await probeUrl("https://firma.de");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("tls_error");
    // nur der https-Versuch, kein zweiter http-Versuch
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/^https:\/\//);
    }
  });

  it("macht KEINEN Fallback bei HTTP-Fehlerstatus (Site erreichbar, aber 404)", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(null, { status: 404 }),
    );

    const res = await probeUrl("firma.de");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("url_dead");
    expect(res.httpStatus).toBe(404);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/^https:\/\//);
    }
  });

  it("liefert den https-Fehler, wenn auch http scheitert", async () => {
    fetchMock.mockImplementation(async () => {
      throw connErr("ECONNREFUSED");
    });

    const res = await probeUrl("firma.de");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("url_dead");
  });

  it("probt schemalose URLs erfolgreich über https (Normalfall)", async () => {
    fetchMock.mockImplementation(async () => okResponse());

    const res = await probeUrl("zahnarzt-ciecior.de");
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toBe("https://zahnarzt-ciecior.de/");
  });
});
