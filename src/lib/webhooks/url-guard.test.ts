/**
 * Tests für `src/lib/webhooks/url-guard.ts`.
 *
 * Wir mocken `node:dns/promises.lookup`, damit die Tests deterministisch
 * sind (kein Netzwerk-Roundtrip) und auch die DNS-Rebinding-Defense
 * sauber abdecken können.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `node:dns/promises` wird in beiden Environments (node + jsdom) gemockt,
// damit die Tests deterministisch sind. In jsdom muss der Mock zusätzlich
// einen `default`-Export anbieten (vitest's CommonJS-Interop). `vi.hoisted`
// stellt sicher, dass `lookupMock` schon vor dem hoisteten vi.mock-Call
// existiert.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: (vi as typeof vi).fn() }));
vi.mock("node:dns/promises", () => {
  const m = { lookup: lookupMock };
  return { ...m, default: m };
});

import { validateWebhookUrl, isIpBlocked } from "@/lib/webhooks/url-guard";

function mockResolve(addrs: Array<{ address: string; family: 4 | 6 }>): void {
  lookupMock.mockResolvedValue(addrs);
}

describe("webhooks/url-guard.isIpBlocked", () => {
  it("blockt RFC1918 IPv4", () => {
    expect(isIpBlocked("10.0.0.1", 4).blocked).toBe(true);
    expect(isIpBlocked("172.16.5.5", 4).blocked).toBe(true);
    expect(isIpBlocked("172.31.255.255", 4).blocked).toBe(true);
    expect(isIpBlocked("172.32.0.1", 4).blocked).toBe(false); // außerhalb /12
    expect(isIpBlocked("192.168.1.1", 4).blocked).toBe(true);
  });
  it("blockt Loopback, Link-Local, CGNAT, Multicast", () => {
    expect(isIpBlocked("127.0.0.1", 4).blocked).toBe(true);
    expect(isIpBlocked("169.254.169.254", 4).blocked).toBe(true); // AWS metadata
    expect(isIpBlocked("100.64.0.1", 4).blocked).toBe(true);
    expect(isIpBlocked("224.0.0.1", 4).blocked).toBe(true);
    expect(isIpBlocked("240.0.0.1", 4).blocked).toBe(true);
  });
  it("passiert öffentliche IPv4", () => {
    expect(isIpBlocked("8.8.8.8", 4).blocked).toBe(false);
    expect(isIpBlocked("1.1.1.1", 4).blocked).toBe(false);
  });
  it("blockt IPv6 Loopback / ULA / Link-Local", () => {
    expect(isIpBlocked("::1", 6).blocked).toBe(true);
    expect(isIpBlocked("fc00::1", 6).blocked).toBe(true);
    expect(isIpBlocked("fd12:3456::1", 6).blocked).toBe(true);
    expect(isIpBlocked("fe80::1", 6).blocked).toBe(true);
  });
  it("blockt IPv4-mapped IPv6 wenn unterliegende v4 privat ist", () => {
    expect(isIpBlocked("::ffff:127.0.0.1", 6).blocked).toBe(true);
    expect(isIpBlocked("::ffff:10.0.0.1", 6).blocked).toBe(true);
    expect(isIpBlocked("::ffff:8.8.8.8", 6).blocked).toBe(false);
  });
});

describe("webhooks/url-guard.validateWebhookUrl", () => {
  beforeEach(() => {
    // process.env.NODE_ENV ist in @types/node ReadOnly; via Bracket-Notation
    // umgehen wir das (TS-Cast wäre uneleganter und wir nutzen denselben
    // Pattern wie in den CRM-Tests, wo das Type-System bewusst gestaucht
    // wird, damit Test-Setups ohne Casts arbeiten können).
    delete (process.env as Record<string, string | undefined>).WEBHOOK_ALLOW_HTTP;
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    lookupMock.mockReset();
  });

  afterEach(() => {
    lookupMock.mockReset();
  });

  it("akzeptiert https://hooks.zapier.com/...", async () => {
    mockResolve([{ address: "54.230.0.1", family: 4 }]);
    const r = await validateWebhookUrl("https://hooks.zapier.com/hooks/catch/123/abc");
    expect(r.ok).toBe(true);
  });

  it("akzeptiert https://hook.eu2.make.com/...", async () => {
    mockResolve([{ address: "34.107.0.1", family: 4 }]);
    const r = await validateWebhookUrl("https://hook.eu2.make.com/abcdef");
    expect(r.ok).toBe(true);
  });

  it("lehnt http:// ohne WEBHOOK_ALLOW_HTTP ab", async () => {
    const r = await validateWebhookUrl("http://example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/HTTPS/i);
  });

  it("erlaubt http:// MIT WEBHOOK_ALLOW_HTTP=1", async () => {
    process.env.WEBHOOK_ALLOW_HTTP = "1";
    mockResolve([{ address: "8.8.8.8", family: 4 }]);
    const r = await validateWebhookUrl("http://example.com");
    expect(r.ok).toBe(true);
  });

  it("lehnt http://localhost/ ab (auch mit ALLOW_HTTP)", async () => {
    process.env.WEBHOOK_ALLOW_HTTP = "1";
    const r = await validateWebhookUrl("http://localhost/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Loopback/);
  });

  it("lehnt *.local und *.localhost ab", async () => {
    process.env.WEBHOOK_ALLOW_HTTP = "1";
    expect((await validateWebhookUrl("http://foo.local/")).ok).toBe(false);
    expect((await validateWebhookUrl("http://bar.localhost/")).ok).toBe(false);
  });

  it("lehnt https://127.0.0.1/ ab (Loopback via CIDR)", async () => {
    // `dns.lookup` mit IP-Literal gibt die IP unverändert zurück.
    mockResolve([{ address: "127.0.0.1", family: 4 }]);
    const r = await validateWebhookUrl("https://127.0.0.1/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/privates Netzwerk/);
  });

  it("lehnt https://192.168.1.1/ ab", async () => {
    mockResolve([{ address: "192.168.1.1", family: 4 }]);
    const r = await validateWebhookUrl("https://192.168.1.1/");
    expect(r.ok).toBe(false);
  });

  it("lehnt https://169.254.169.254/ (AWS metadata) ab", async () => {
    mockResolve([{ address: "169.254.169.254", family: 4 }]);
    const r = await validateWebhookUrl("https://169.254.169.254/");
    expect(r.ok).toBe(false);
  });

  it("lehnt https://[::1]/ ab", async () => {
    mockResolve([{ address: "::1", family: 6 }]);
    const r = await validateWebhookUrl("https://[::1]/");
    expect(r.ok).toBe(false);
  });

  it("lehnt ftp:// ab (Schema)", async () => {
    const r = await validateWebhookUrl("ftp://example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/HTTPS/i);
  });

  it("lehnt numeric-Hostname (decimal-IP-Form) ab", async () => {
    // Node's URL-Parser normalisiert decimal-IP-Form (2852039166) zu der
    // 169.254.169.254-Schreibweise — daher greift hier nicht der
    // looksLikeNumericHost-Branch, sondern die CIDR-Block-Liste. Wir
    // mocken dns.lookup für ein IP-Literal so, dass es das Literal
    // zurückgibt (Node's reales Verhalten).
    mockResolve([{ address: "169.254.169.254", family: 4 }]);
    const r = await validateWebhookUrl("https://2852039166/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/privates Netzwerk|Numeric/i);
  });


  it("DNS-Rebinding: mockt einen öffentlichen Hostnamen auf private IP → ablehnen", async () => {
    mockResolve([{ address: "10.0.0.5", family: 4 }]);
    const r = await validateWebhookUrl("https://evil.example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/privates Netzwerk/);
  });

  it("lehnt ab, wenn auch nur EINE der gemischten Antworten privat ist", async () => {
    mockResolve([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const r = await validateWebhookUrl("https://mixed.example.com/");
    expect(r.ok).toBe(false);
  });

  it("lehnt fremden Port in Production ab", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    mockResolve([{ address: "8.8.8.8", family: 4 }]);
    const r = await validateWebhookUrl("https://example.com:8080/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Port/);
  });

  it("erlaubt Port 443 in Production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    mockResolve([{ address: "8.8.8.8", family: 4 }]);
    const r = await validateWebhookUrl("https://example.com:443/");
    expect(r.ok).toBe(true);
  });

  it("malformed URL → reason `URL ungültig`", async () => {
    const r = await validateWebhookUrl("nope-this-is-not-a-url");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ungültig|invalid/i);
  });
});
