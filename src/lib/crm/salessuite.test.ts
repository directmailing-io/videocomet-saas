/**
 * Salessuite-Provider-Tests.
 *
 * Beispiel-Bodies sind 1:1 die live verifizierten Antworten der
 * Salessuite-API (Tenant DigiSpace, 2026-06).
 */
import { afterEach, describe, expect, it } from "vitest";
import { salessuiteProvider } from "@/lib/crm/salessuite";
import { CrmFeatureUnsupportedError } from "@/lib/crm/types";
import { installFetchMock, type FetchMock } from "@/lib/crm/test-utils";

const API_KEY = "ss_test_key_AABB";

let mock: FetchMock | null = null;

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

const AUTH_RESPONSE = {
  tenantId: "cmpphrcax3dks3j01u5cr129v",
  name: "DigiSpace GmbH",
  currency: "EUR",
  timezone: "Europe/Berlin",
  language: "de",
};

const PROPERTY_RESPONSE_SAMPLE = {
  fullPropertyIdentifier: "contact_x_videocomet_klick",
  propertyIdentifier: "x_videocomet_klick",
  typeDefinition: { type: "dateTime", variant: "dateTime" },
  fieldName: "Videocomet-Klick",
  id: "cmq6l6p1k0143f901fon4p6hu",
  cardType: "Contact",
  propertyType: "dynamic",
  required: false,
  visibleInCard: true,
  card: { id: "c123", name: "Sales-Informationen" },
};

describe("salessuiteProvider.testConnection", () => {
  it("liefert ok:true + metadata bei 200", async () => {
    mock = installFetchMock([{ status: 200, json: AUTH_RESPONSE }]);
    const res = await salessuiteProvider.testConnection(API_KEY);
    expect(res.ok).toBe(true);
    expect(res.metadata?.tenantId).toBe("cmpphrcax3dks3j01u5cr129v");
    const req = mock!.requests[0]!;
    expect(req.url).toBe("https://api.salessuite.com/api/v1/auth");
    expect(req.headers["x-api-key"]).toBe(API_KEY);
    expect(req.headers.authorization).toBeUndefined();
  });

  it("liefert ok:false bei 401", async () => {
    mock = installFetchMock([{ status: 401, json: { error: "nope" } }]);
    const res = await salessuiteProvider.testConnection(API_KEY);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Salessuite/);
  });
});

describe("salessuiteProvider.listContactFields", () => {
  it("mapped propertyIdentifier → key, fieldName → label, dynamic → writable", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: [
          PROPERTY_RESPONSE_SAMPLE,
          {
            ...PROPERTY_RESPONSE_SAMPLE,
            propertyIdentifier: "email",
            fieldName: "E-Mail",
            typeDefinition: { type: "text", variant: "text" },
            propertyType: "system",
            id: "sys-email",
          },
        ],
      },
    ]);
    const fields = await salessuiteProvider.listContactFields(API_KEY);
    expect(fields).toEqual([
      {
        key: "x_videocomet_klick",
        label: "Videocomet-Klick",
        type: "datetime",
        readonly: false,
      },
      {
        key: "email",
        label: "E-Mail",
        type: "text",
        readonly: true,
      },
    ]);
  });
});

describe("salessuiteProvider.createContactField", () => {
  it("wirft immer CrmFeatureUnsupportedError", async () => {
    mock = installFetchMock([]);
    await expect(
      salessuiteProvider.createContactField(API_KEY, {
        label: "Videocomet-Klick",
        type: "datetime",
      }),
    ).rejects.toBeInstanceOf(CrmFeatureUnsupportedError);
  });
});

describe("salessuiteProvider.findContactByField", () => {
  it("0 Treffer (leeres Array) → []", async () => {
    mock = installFetchMock([{ status: 200, json: [] }]);
    const res = await salessuiteProvider.findContactByField(
      API_KEY,
      "email",
      "x@y.de",
    );
    expect(res).toEqual([]);
  });

  it("1 Treffer → mapped CrmContact mit Email aus mainContactPerson", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: [
          {
            contact: { id: "ctc_1" },
            mainContactPerson: { email: "alice@example.de", phone: null },
          },
        ],
      },
    ]);
    const res = await salessuiteProvider.findContactByField(
      API_KEY,
      "email",
      "alice@example.de",
    );
    expect(res).toEqual([
      expect.objectContaining({ id: "ctc_1", email: "alice@example.de" }),
    ]);
    const req = mock!.requests[0]!;
    expect(req.url).toBe(
      "https://api.salessuite.com/api/v1/contact/by-email?email=alice%40example.de",
    );
  });

  it("mehrere Treffer → mehrere CrmContact-Rows", async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: [
          {
            contact: { id: "ctc_1" },
            mainContactPerson: { email: "a@b.de" },
          },
          {
            contact: { id: "ctc_2" },
            mainContactPerson: { email: "a@b.de" },
          },
        ],
      },
    ]);
    const res = await salessuiteProvider.findContactByField(
      API_KEY,
      "email",
      "a@b.de",
    );
    expect(res.map((r) => r.id)).toEqual(["ctc_1", "ctc_2"]);
  });

  it("phone-Lookup → leeres Array OHNE HTTP-Aufruf", async () => {
    mock = installFetchMock([]);
    const res = await salessuiteProvider.findContactByField(
      API_KEY,
      "phone",
      "+491701234567",
    );
    expect(res).toEqual([]);
    expect(mock!.requests.length).toBe(0);
  });
});

describe("salessuiteProvider.updateContactFields", () => {
  it("PATCH /v2/contact/{id} mit flachem Body + x-api-key", async () => {
    mock = installFetchMock([{ status: 200, json: { ok: true } }]);
    await salessuiteProvider.updateContactFields(API_KEY, "ctc_42", {
      x_videocomet_klick: "2026-06-14T12:00:00Z",
    });
    const req = mock!.requests[0]!;
    expect(req.method).toBe("PATCH");
    expect(req.url).toBe("https://api.salessuite.com/api/v2/contact/ctc_42");
    expect(req.headers["x-api-key"]).toBe(API_KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(JSON.parse(req.body!)).toEqual({
      x_videocomet_klick: "2026-06-14T12:00:00Z",
    });
  });
});
