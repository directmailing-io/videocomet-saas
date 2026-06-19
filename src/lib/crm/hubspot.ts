/**
 * HubSpot CRM provider.
 *
 * Docs (Stand 2026-06): https://developers.hubspot.com/docs/api/crm/contacts
 *
 * Auth: Private-App-Token via `Authorization: Bearer <token>`. Wir
 * unterstützen explizit keine OAuth-Apps in dieser Phase — Single-Tenant-
 * Access-Token reicht für die 5-7 Beta-Kunden.
 */

import { crmFetch } from "./http";
import {
  CrmFeatureUnsupportedError,
  CrmHttpError,
  type CrmContact,
  type CrmField,
  type CrmFieldSpec,
  type CrmProvider,
} from "./types";

const BASE_URL = "https://api.hubapi.com";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * HubSpot teilt das Schema in `type` + `fieldType` auf:
 *   - type=datetime / date    → "datetime"
 *   - type=string + fieldType=text/textarea/file/url/phonenumber → "text"
 *   - type=number             → "number"
 *   - type=bool               → "boolean"
 *   - alles andere            → "other"
 */
function mapHubspotType(
  type: string | undefined,
  fieldType: string | undefined,
): CrmField["type"] {
  const t = (type ?? "").toLowerCase();
  const ft = (fieldType ?? "").toLowerCase();
  if (t === "datetime" || t === "date") return "datetime";
  if (t === "number") return "number";
  if (t === "bool" || t === "boolean") return "boolean";
  if (t === "string") {
    if (
      ft === "text" ||
      ft === "textarea" ||
      ft === "file" ||
      ft === "phonenumber" ||
      ft === ""
    ) {
      return "text";
    }
  }
  return "other";
}

interface HubspotPropertyRaw {
  name: string;
  label: string;
  type?: string;
  fieldType?: string;
  modificationMetadata?: { readOnlyValue?: boolean };
}

function mapHubspotProperty(p: HubspotPropertyRaw): CrmField {
  return {
    key: p.name,
    label: p.label,
    type: mapHubspotType(p.type, p.fieldType),
    readonly: p.modificationMetadata?.readOnlyValue === true,
  };
}

/**
 * Leitet einen maschinen-lesbaren `name` aus einem Label ab:
 *   "Videocomet Last View" → "videocomet_last_view"
 * Wenn nicht schon mit `videocomet_` präfixiert, fügen wir das hinzu —
 * damit wir unsere eigenen Felder im HubSpot-Schema wiederfinden.
 */
function deriveHubspotName(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return base.startsWith("videocomet_") ? base : `videocomet_${base}`;
}

export const hubspotProvider: CrmProvider = {
  id: "hubspot",

  async testConnection(apiKey) {
    try {
      const res = await crmFetch(
        "hubspot",
        `${BASE_URL}/crm/v3/objects/contacts?limit=1`,
        { headers: authHeaders(apiKey) },
      );
      // 200 OK reicht — wir parsen das Body nicht, nur Status.
      if (res.ok) return { ok: true, metadata: {} };
      return { ok: false, error: `Unexpected status ${res.status}` };
    } catch (err) {
      if (err instanceof CrmHttpError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, error: "Ungültiger HubSpot-API-Key" };
        }
        return { ok: false, error: `HubSpot HTTP ${err.status}` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async listContactFields(apiKey) {
    const res = await crmFetch(
      "hubspot",
      `${BASE_URL}/crm/v3/properties/contacts`,
      { headers: authHeaders(apiKey) },
    );
    const data = (await res.json()) as { results?: HubspotPropertyRaw[] };
    const results = data.results ?? [];
    return results.map(mapHubspotProperty);
  },

  async createContactField(apiKey, spec) {
    const name = spec.name ?? deriveHubspotName(spec.label);
    const body =
      spec.type === "datetime"
        ? {
            name,
            label: spec.label,
            type: "datetime",
            fieldType: "date",
            groupName: "contactinformation",
          }
        : {
            name,
            label: spec.label,
            type: "string",
            fieldType: "text",
            groupName: "contactinformation",
          };
    const res = await crmFetch(
      "hubspot",
      `${BASE_URL}/crm/v3/properties/contacts`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify(body),
      },
    );
    const raw = (await res.json()) as HubspotPropertyRaw;
    return mapHubspotProperty(raw);
  },

  async findContactByField(apiKey, field, value) {
    const propertyName = field === "email" ? "email" : "phone";
    const body = {
      filterGroups: [
        {
          filters: [{ propertyName, operator: "EQ", value }],
        },
      ],
      properties: ["email"],
      limit: 10,
    };
    const res = await crmFetch(
      "hubspot",
      `${BASE_URL}/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as {
      results?: Array<{ id: string; properties?: { email?: string } }>;
    };
    const results = data.results ?? [];
    return results.map<CrmContact>((r) => ({
      id: r.id,
      email: r.properties?.email ?? null,
      raw: r as unknown as Record<string, unknown>,
    }));
  },

  async updateContactFields(apiKey, contactId, fields) {
    const res = await crmFetch(
      "hubspot",
      `${BASE_URL}/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
      {
        method: "PATCH",
        headers: authHeaders(apiKey),
        body: JSON.stringify({ properties: fields }),
      },
    );
    const raw = (await res.json().catch(() => null)) as unknown;
    return { ok: true, raw };
  },
};

// Re-export für gezielte Tests.
export { CrmFeatureUnsupportedError };
