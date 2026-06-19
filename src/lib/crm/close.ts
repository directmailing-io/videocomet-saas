/**
 * Close CRM provider.
 *
 * Docs (Stand 2026-06): https://developer.close.com/
 *
 * Auth: HTTP-Basic, `apiKey` als username, leeres password — kein
 * Bearer-Token. Custom-Fields tragen IDs vom Schema `cf_xxxxx` und werden
 * im Update-Body als `custom.<cf_id>` Property-Keys gesetzt.
 */

import { crmFetch } from "./http";
import {
  CrmHttpError,
  type CrmContact,
  type CrmField,
  type CrmFieldSpec,
  type CrmProvider,
} from "./types";

const BASE_URL = "https://api.close.com/api/v1";

function authHeaders(apiKey: string): Record<string, string> {
  // username = apiKey, password = empty
  const token = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
}

interface CloseCustomFieldRaw {
  id: string;
  name: string;
  type: string;
  choices?: string[];
}

function mapCloseType(t: string | undefined): CrmField["type"] {
  const v = (t ?? "").toLowerCase();
  if (v === "datetime" || v === "date") return "datetime";
  if (v === "text" || v === "textarea") return "text";
  if (v === "number" || v === "integer" || v === "float") return "number";
  if (v === "bool" || v === "boolean") return "boolean";
  return "other";
}

function mapCloseField(p: CloseCustomFieldRaw): CrmField {
  return {
    key: p.id,
    label: p.name,
    type: mapCloseType(p.type),
    readonly: false,
  };
}

interface CloseContactRaw {
  id: string;
  name?: string | null;
  emails?: Array<{ email?: string }>;
}

interface CloseMeRaw {
  id?: string;
  email?: string;
}

export const closeProvider: CrmProvider = {
  id: "close",

  async testConnection(apiKey) {
    try {
      const res = await crmFetch("close", `${BASE_URL}/me/`, {
        headers: authHeaders(apiKey),
      });
      const body = (await res.json().catch(() => null)) as CloseMeRaw | null;
      if (!body) return { ok: false, error: "Close /me/ lieferte leeren Body" };
      return {
        ok: true,
        metadata: {
          id: body.id,
          email: body.email,
        },
      };
    } catch (err) {
      if (err instanceof CrmHttpError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, error: "Ungültiger Close-API-Key" };
        }
        return { ok: false, error: `Close HTTP ${err.status}` };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async listContactFields(apiKey) {
    const res = await crmFetch(
      "close",
      `${BASE_URL}/custom_field/contact/`,
      { headers: authHeaders(apiKey) },
    );
    const data = (await res.json()) as { data?: CloseCustomFieldRaw[] };
    const results = data.data ?? [];
    return results.map(mapCloseField);
  },

  async createContactField(apiKey, spec: CrmFieldSpec) {
    const body = {
      name: spec.label,
      type: spec.type, // "datetime" | "text" — Close akzeptiert beide direkt
    };
    const res = await crmFetch(
      "close",
      `${BASE_URL}/custom_field/contact/`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify(body),
      },
    );
    const raw = (await res.json()) as CloseCustomFieldRaw;
    return mapCloseField(raw);
  },

  async findContactByField(apiKey, field, value) {
    const query =
      field === "email"
        ? `email_address:"${value}"`
        : `phone:"${value}"`;
    const url = `${BASE_URL}/contact/?query=${encodeURIComponent(query)}`;
    const res = await crmFetch("close", url, {
      headers: authHeaders(apiKey),
    });
    const data = (await res.json()) as { data?: CloseContactRaw[] };
    const results = data.data ?? [];
    return results.map<CrmContact>((r) => ({
      id: r.id,
      email: r.emails?.[0]?.email ?? null,
      raw: r as unknown as Record<string, unknown>,
    }));
  },

  async updateContactFields(apiKey, contactId, fields) {
    // Close erwartet `{ "custom.cf_xxx": "value", … }` als Top-Level-Body.
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      body[`custom.${k}`] = v;
    }
    const res = await crmFetch(
      "close",
      `${BASE_URL}/contact/${encodeURIComponent(contactId)}/`,
      {
        method: "PUT",
        headers: authHeaders(apiKey),
        body: JSON.stringify(body),
      },
    );
    const raw = (await res.json().catch(() => null)) as unknown;
    return { ok: true, raw };
  },
};
