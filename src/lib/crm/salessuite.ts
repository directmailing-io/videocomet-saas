/**
 * Salessuite CRM provider.
 *
 * Docs verifiziert live (Tenant DigiSpace, Stand 2026-06):
 *   - Base URL:  https://api.salessuite.com/api
 *   - Auth:      `x-api-key: <key>` (NICHT Bearer)
 *   - Sprache:   `x-lang: de` als Hint
 *
 * Eigenheiten:
 *   - Custom-Felder werden im Salessuite-UI gepflegt; die API hat keinen
 *     POST-Endpoint dafür. `createContactField` wirft daher gezielt
 *     `CrmFeatureUnsupportedError`.
 *   - Update-Body ist FLACH: `{ "<propertyIdentifier>": "value", … }`,
 *     keine `properties: {…}` Verschachtelung wie HubSpot.
 *   - Phone-Lookup hat keinen dedizierten Endpoint in v1 — wir liefern
 *     für phone-Lookups in dieser Phase deterministisch `[]` zurück. Phase
 *     2 kann das via `/v1/contact/search?query=…` clientseitig nachbauen.
 */

import { crmFetch } from "./http";
import {
  CrmFeatureUnsupportedError,
  CrmHttpError,
  type CrmContact,
  type CrmField,
  type CrmProvider,
} from "./types";

const BASE_URL = "https://api.salessuite.com/api";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "x-lang": "de",
    "Content-Type": "application/json",
  };
}

interface SalessuitePropertyRaw {
  fullPropertyIdentifier?: string;
  propertyIdentifier: string;
  typeDefinition?: { type?: string; variant?: string };
  fieldName: string;
  id?: string;
  cardType?: string;
  /** 'system' | 'dynamic' — nur `dynamic` ist via API beschreibbar. */
  propertyType?: string;
  required?: boolean;
  visibleInCard?: boolean;
  card?: { id?: string; name?: string };
}

function mapSalessuiteType(t: string | undefined): CrmField["type"] {
  const v = (t ?? "").toLowerCase();
  if (v === "datetime" || v === "date") return "datetime";
  if (v === "text" || v === "string") return "text";
  if (v === "number" || v === "integer" || v === "float" || v === "decimal") {
    return "number";
  }
  if (v === "bool" || v === "boolean") return "boolean";
  return "other";
}

function mapSalessuiteProperty(p: SalessuitePropertyRaw): CrmField {
  return {
    key: p.propertyIdentifier,
    label: p.fieldName,
    type: mapSalessuiteType(p.typeDefinition?.type),
    readonly: p.propertyType === "system",
  };
}

interface SalessuiteAuthResponse {
  tenantId?: string;
  name?: string;
  currency?: string;
  timezone?: string;
  language?: string;
}

interface SalessuiteContactPerson {
  email?: string | null;
  phone?: string | null;
}

interface SalessuiteContactWithPersons {
  contact: { id: string };
  mainContactPerson?: SalessuiteContactPerson | null;
  contactPersons?: SalessuiteContactPerson[];
}

export const salessuiteProvider: CrmProvider = {
  id: "salessuite",

  async testConnection(apiKey) {
    try {
      const res = await crmFetch("salessuite", `${BASE_URL}/v1/auth`, {
        headers: authHeaders(apiKey),
      });
      const body = (await res.json().catch(() => null)) as
        | SalessuiteAuthResponse
        | null;
      if (!body || !body.tenantId) {
        return { ok: false, error: "Salessuite /v1/auth lieferte kein tenantId" };
      }
      return {
        ok: true,
        metadata: body as unknown as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof CrmHttpError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, error: "Ungültiger Salessuite-API-Key" };
        }
        return { ok: false, error: `Salessuite HTTP ${err.status}` };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async listContactFields(apiKey) {
    const res = await crmFetch(
      "salessuite",
      `${BASE_URL}/v1/property?cardType=contact`,
      { headers: authHeaders(apiKey) },
    );
    const data = (await res.json()) as SalessuitePropertyRaw[];
    return data.map(mapSalessuiteProperty);
  },

  async createContactField(_apiKey, _spec) {
    throw new CrmFeatureUnsupportedError(
      "Salessuite verwaltet Custom-Fields nur direkt in den Salessuite-Einstellungen. " +
        "Lege das Feld dort an und klicke dann auf 'Felder neu laden'.",
    );
  },

  async findContactByField(apiKey, field, value) {
    if (field !== "email") {
      // Phase-1: phone-Lookup wird in Salessuite v1 nicht direkt unterstützt.
      // Wir geben deterministisch `[]` zurück — kein Fehler, damit Phase-2-
      // Worker den Lead-Push ohne Crash überspringen kann.
      return [];
    }
    const url = `${BASE_URL}/v1/contact/by-email?email=${encodeURIComponent(
      value,
    )}`;
    const res = await crmFetch("salessuite", url, {
      headers: authHeaders(apiKey),
    });
    const data = (await res.json().catch(() => [])) as SalessuiteContactWithPersons[];
    if (!Array.isArray(data)) return [];
    return data.map<CrmContact>((row) => ({
      id: row.contact.id,
      email: row.mainContactPerson?.email ?? null,
      raw: row as unknown as Record<string, unknown>,
    }));
  },

  async updateContactFields(apiKey, contactId, fields) {
    // Salessuite v2: flache Property-Map als Body.
    const res = await crmFetch(
      "salessuite",
      `${BASE_URL}/v2/contact/${encodeURIComponent(contactId)}`,
      {
        method: "PATCH",
        headers: authHeaders(apiKey),
        body: JSON.stringify(fields),
      },
    );
    const raw = (await res.json().catch(() => null)) as unknown;
    return { ok: true, raw };
  },
};
