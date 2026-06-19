/**
 * Close-Provider-Tests. Prüfen u.a., dass die Basic-Auth wirklich
 * `<apiKey>:` (mit leerem Password) base64-encoded ist und dass
 * `updateContactFields` die `custom.cf_xxx`-Key-Konvention einhält.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeProvider } from "@/lib/crm/close";
import { installFetchMock, type FetchMock } from "@/lib/crm/test-utils";

const API_KEY = "api_close_test_AAAA";
const EXPECTED_BASIC = `Basic ${Buffer.from(`${API_KEY}:`, "utf8").toString("base64")}`;

let mock: FetchMock | null = null;

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

describe("closeProvider.testConnection", () => {
  it("liefert ok:true + metadata bei 200", async () => {
    mock = installFetchMock([
      { status: 200, json: { id: "user_1", email: "me@team.com" } },
    ]);
    const res = await closeProvider.testConnection(API_KEY);
    expect(res.ok).toBe(true);
    expect(res.metadata).toEqual({ id: "user_1", email: "me@team.com" });
    expect(mock!.requests[0]!.headers.authorization).toBe(EXPECTED_BASIC);
  });

  it("liefert ok:false bei 401", async () => {
    mock = installFetchMock([{ status: 401, json: { error: "bad key" } }]);
    const res = await closeProvider.testConnection(API_KEY);
    expect(res.ok).toBe(false);
  });
});

describe("closeProvider.listContactFields", () => {
  it("mapped cf-Felder auf CrmField", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          data: [
            { id: "cf_aaa", name: "Newsletter", type: "text" },
            { id: "cf_bbb", name: "Last Click", type: "datetime" },
          ],
        },
      },
    ]);
    const fields = await closeProvider.listContactFields(API_KEY);
    expect(fields).toEqual([
      { key: "cf_aaa", label: "Newsletter", type: "text", readonly: false },
      { key: "cf_bbb", label: "Last Click", type: "datetime", readonly: false },
    ]);
  });
});

describe("closeProvider.findContactByField", () => {
  it("0 Treffer → []", async () => {
    mock = installFetchMock([{ status: 200, json: { data: [] } }]);
    const res = await closeProvider.findContactByField(
      API_KEY,
      "email",
      "x@y.de",
    );
    expect(res).toEqual([]);
  });

  it("1 Treffer email-Lookup → CrmContact, Query enthält email_address:", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          data: [
            { id: "cnt_1", emails: [{ email: "a@b.de" }] },
          ],
        },
      },
    ]);
    const res = await closeProvider.findContactByField(
      API_KEY,
      "email",
      "a@b.de",
    );
    expect(res).toEqual([
      expect.objectContaining({ id: "cnt_1", email: "a@b.de" }),
    ]);
    expect(mock!.requests[0]!.url).toContain("email_address");
  });

  it("mehrere Treffer → mehrere Rows", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          data: [
            { id: "cnt_1", emails: [{ email: "a@b.de" }] },
            { id: "cnt_2", emails: [{ email: "a@b.de" }] },
          ],
        },
      },
    ]);
    const res = await closeProvider.findContactByField(
      API_KEY,
      "email",
      "a@b.de",
    );
    expect(res.map((r) => r.id)).toEqual(["cnt_1", "cnt_2"]);
  });

  it("phone-Lookup nutzt query phone:", async () => {
    mock = installFetchMock([{ status: 200, json: { data: [] } }]);
    await closeProvider.findContactByField(API_KEY, "phone", "+491700000000");
    expect(mock!.requests[0]!.url).toContain("phone%3A");
  });
});

describe("closeProvider.updateContactFields", () => {
  it("PUT mit custom.<cf_id>-Keys und Basic-Auth", async () => {
    mock = installFetchMock([{ status: 200, json: { id: "cnt_1" } }]);
    await closeProvider.updateContactFields(API_KEY, "cnt_1", {
      cf_aaa: "Newsletter",
      cf_bbb: "2026-06-14T12:00:00Z",
    });
    const req = mock!.requests[0]!;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://api.close.com/api/v1/contact/cnt_1/");
    expect(req.headers.authorization).toBe(EXPECTED_BASIC);
    expect(JSON.parse(req.body!)).toEqual({
      "custom.cf_aaa": "Newsletter",
      "custom.cf_bbb": "2026-06-14T12:00:00Z",
    });
  });
});
