/**
 * Admin-Audit-Log (Security-Härtung 2026-09-02).
 *
 * Jede mutierende Admin-Aktion ruft `logAdminAction()` auf. Der Aufruf ist
 * absichtlich "best effort": ein Fehler beim Protokollieren darf die
 * eigentliche Aktion nie blockieren (sonst könnte ein DB-Hänger den Admin
 * aussperren). Fehler landen im Container-Log.
 *
 * Die Login-Seite verspricht "Alle Aktionen werden protokolliert" — seit
 * dieser Tabelle stimmt das auch.
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/lib/db/schema";
import { getClientIp } from "@/lib/tracking";

export type AdminAuditAction =
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.activate"
  | "user.deactivate"
  | "user.set_password"
  | "user.send_reset"
  | "user.comp_access.grant"
  | "user.comp_access.revoke"
  | "billing.adjust"
  | "domain.recheck"
  | "domain.reset"
  | "domain.delete"
  | "email_blast.cancel"
  | "run.regenerate"
  | "lead.regenerate"
  | "totp.enable"
  | "totp.disable";

export interface AdminAuditInput {
  admin: { id: string; email?: string | null };
  action: AdminAuditAction;
  targetType?: "user" | "domain" | "email_blast" | "run" | "lead" | "self";
  targetId?: string | null;
  details?: Record<string, unknown>;
  req?: NextRequest | null;
}

export async function logAdminAction(input: AdminAuditInput): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      adminUserId: input.admin.id,
      adminEmail: input.admin.email ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      details: input.details ?? null,
      ip: input.req ? getClientIp(input.req) || null : null,
    });
  } catch (err) {
    console.error("[admin-audit] konnte Aktion nicht protokollieren:", input.action, err);
  }
}
