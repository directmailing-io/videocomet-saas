/**
 * Tenant-Guard Helper für die Webhook-REST-Routen.
 *
 * Trennt den Pattern „Endpoint-by-id lesen + Owner-Check" aus jeder
 * Route raus. Wirft ein einheitliches `"Not found"`-Error, das die
 * Caller via try/catch in eine 404-Response umsetzen.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEndpoints } from "@/lib/db/schema";
import type { WebhookEndpoint } from "@/lib/db/schema";

/**
 * Lädt einen Webhook-Endpoint und prüft Owner-Match. Wirft `"Not found"`
 * wenn ID nicht existiert ODER User nicht Owner ist (kein Leak von
 * Existenz-Information zwischen Tenants).
 */
export async function requireWebhookEndpoint(
  id: string,
  userId: string,
): Promise<WebhookEndpoint> {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Validierung von custom-headers (POST + PATCH). Wirft mit deutscher
 * Fehlermeldung wenn ein verbotener Key oder ein nicht-druckbares
 * Zeichen enthalten ist.
 *
 * Verboten (case-insensitive):
 *   - host / content-length / content-type / connection / transfer-encoding
 *   - jeder Key mit Präfix `x-videocomet-`
 *
 * Format:
 *   - Header-Key: `^[A-Za-z0-9-]+$`
 *   - Header-Wert: `^[\x20-\x7E]+$` (kein CR/LF, nur ASCII-druckbar)
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
]);

const HEADER_KEY_RE = /^[A-Za-z0-9-]+$/;
const HEADER_VAL_RE = /^[\x20-\x7E]+$/;

export interface HeaderValidationError {
  message: string;
}

export function validateCustomHeaders(
  headers: Record<string, string>,
): HeaderValidationError | null {
  for (const [rawKey, rawVal] of Object.entries(headers)) {
    if (typeof rawKey !== "string" || typeof rawVal !== "string") {
      return { message: "Header-Werte müssen Strings sein." };
    }
    if (!HEADER_KEY_RE.test(rawKey)) {
      return {
        message: `Ungültiger Header-Name: \"${rawKey}\". Nur Buchstaben, Ziffern und Bindestriche erlaubt.`,
      };
    }
    const lower = rawKey.toLowerCase();
    if (FORBIDDEN_HEADER_NAMES.has(lower)) {
      return {
        message: `Header \"${rawKey}\" darf nicht gesetzt werden (System-Header).`,
      };
    }
    if (lower.startsWith("x-videocomet-")) {
      return {
        message: `Header \"${rawKey}\" ist reserviert (X-VideoComet-* darf nicht überschrieben werden).`,
      };
    }
    if (!HEADER_VAL_RE.test(rawVal)) {
      return {
        message: `Ungültiger Header-Wert für \"${rawKey}\": nicht-druckbare Zeichen oder Zeilenumbrüche sind verboten.`,
      };
    }
  }
  return null;
}
