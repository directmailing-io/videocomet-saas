/**
 * HubSpot-Provider-Tests. Mocken `fetch`, prüfen Request-Shape
 * (URL, Methode, Auth-Header, Body) und das Mapping der HubSpot-
 * Antworten in die `CrmField` / `CrmContact` Form.
 */
import { afterEach, describe, expect, it } from "vitest";
import { hubspotProvider } from "@/lib/crm/hubspot";
import { installFetchMock, type FetchMock } from "@/lib/crm/test-utils";

const API_KEY = "pat-na1-test-1234";

let mock: FetchMock | null = null;

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

describe("hubspotProvider.testConnection", () => {
  it("liefert ok:true bei 200", async () => {
    mock = installFetchMock([{ status: 200, json: { results: [] } }]);
    const res = await hubspotProvider.testConnection(API_KEY);
    expect(res.ok).toBe(true);
    expect(mock.requests[0]!.url).toBe(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
    );
    expect(mock.requests[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("liefert ok:false bei 401", async () => {
    mock = installFetchMock([{ status: 401, json: { message: "nope" } }]);
    const res = await hubspotProvider.testConnection(API_KEY);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HubSpot/);
  });
});

describe("hubspotProvider.listContactFields", () => {
  it("mapped HubSpot-Properties auf CrmField", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          results: [
            {
              name: "email",
              label: "Email",
              type: "string",
              fieldType: "text",
              modificationMetadata: { readOnlyValue: true },
            },
            {
              name: "videocomet_last_view",
              label: "Videocomet Last View",
              type: "datetime",
              fieldType: "date",
              modificationMetadata: { readOnlyValue: false },
            },
          ],
        },
      },
    ]);
    const fields = await hubspotProvider.listContactFields(API_KEY);
    expect(fields).toEqual([
      { key: "email", label: "Email", type: "text", readonly: true },
      {
        key: "videocomet_last_view",
        label: "Videocomet Last View",
        type: "datetime",
        readonly: false,
      },
    ]);
  });
});

describe("hubspotProvider.findContactByField", () => {
  it("0 Treffer → leeres Array", async () => {
    mock = installFetchMock([{ status: 200, json: { results: [] } }]);
    const res = await hubspotProvider.findContactByField(
      API_KEY,
      "email",
      "nobody@example.com",
    );
    expect(res).toEqual([]);
  });

  it("1 Treffer → eine CrmContact-Row", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          results: [
            { id: "101", properties: { email: "a@b.de" } },
          ],
        },
      },
    ]);
    const res = await hubspotProvider.findContactByField(API_KEY, "email", "a@b.de");
    expect(res.length).toBe(1);
    expect(res[0]).toMatchObject({ id: "101", email: "a@b.de" });
    // Request-Shape prüfen
    const req = mock!.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
    const body = JSON.parse(req.body!) as {
      filterGroups: Array<{ filters: Array<{ propertyName: string; value: string; operator: string }> }>;
    };
    expect(body.filterGroups[0]!.filters[0]).toEqual({
      propertyName: "email",
      operator: "EQ",
      value: "a@b.de",
    });
  });

  it("mehrere Treffer → mehrere Rows", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: {
          results: [
            { id: "1", properties: { email: "a@b.de" } },
            { id: "2", properties: { email: "a@b.de" } },
          ],
        },
      },
    ]);
    const res = await hubspotProvider.findContactByField(API_KEY, "email", "a@b.de");
    expect(res.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("hubspotProvider.updateContactFields", () => {
  it("PATCH mit { properties: {...} } und Bearer-Auth", async () => {
    mock = installFetchMock([{ status: 200, json: { id: "42" } }]);
    await hubspotProvider.updateContactFields(API_KEY, "42", {
      videocomet_last_view: "2026-06-14T10:00:00Z",
    });
    const req = mock!.requests[0]!;
    expect(req.method).toBe("PATCH");
    expect(req.url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/42");
    expect(req.headers.authorization).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(req.body!) as { properties: Record<string, string> };
    expect(body.properties).toEqual({
      videocomet_last_view: "2026-06-14T10:00:00Z",
    });
  });
});
