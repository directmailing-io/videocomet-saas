import { createHash } from "node:crypto";

/**
 * SHA-256 mit Meta-CAPI-Normalisierung (Kleinbuchstaben + Trim). Rückgabe
 * ist hex-lowercase — Meta erwartet exakt diese Form für Advanced Matching.
 *
 * Für nicht-hashbare Felder (z.B. `client_ip_address`, `client_user_agent`,
 * `fbp`, `fbc`) NIEMALS diesen Helper aufrufen — Meta parsed dort Klartext.
 */
export function hashForCapi(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed, "utf8").digest("hex");
}
