export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Zwei-Faktor-Verwaltung für das eigene Admin-Konto.
 *
 *  GET    /api/admin/totp          → { enabled, enabledAt }
 *  POST   /api/admin/totp          → Setup starten: neues Secret, QR-Code
 *                                    (Data-URL) + setupToken (10 Min, Secret
 *                                    darin verschlüsselt). Noch NICHT aktiv.
 *  PUT    /api/admin/totp          → Aktivieren: { setupToken, code, adminPassword }
 *  DELETE /api/admin/totp          → Deaktivieren: { code, adminPassword }
 *
 * Aktivierung verlangt Passwort UND einen gültigen Code aus der App, damit
 * niemand 2FA mit einem Secret einschaltet, das er selbst nicht besitzt
 * (Aussperr-Schutz). Deaktivieren verlangt Passwort UND aktuellen Code.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { requireAdminApi } from "@/lib/auth-guard";
import { requireAdminPassword } from "@/lib/admin-reauth";
import { logAdminAction } from "@/lib/admin-audit";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  otpauthUrl,
  signShortToken,
  verifyShortToken,
  verifyTotp,
} from "@/lib/totp";

async function loadTotpState(userId: string) {
  const [row] = await db
    .select({ totpSecretEnc: users.totpSecretEnc, totpEnabledAt: users.totpEnabledAt, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function GET() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const state = await loadTotpState(guard.user.id);
  return NextResponse.json({
    enabled: Boolean(state?.totpEnabledAt),
    enabledAt: state?.totpEnabledAt ?? null,
  });
}

export async function POST() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const state = await loadTotpState(guard.user.id);
  if (!state) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const secret = generateTotpSecret();
  const url = otpauthUrl(secret, state.email);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 });
  // Secret nur verschlüsselt ins (signierte, aber lesbare) Token.
  const setupToken = signShortToken(
    { uid: guard.user.id, enc: encryptTotpSecret(secret) },
    10 * 60,
    "totp-setup",
  );
  return NextResponse.json({ qrDataUrl, manualKey: secret, setupToken });
}

const enableSchema = z.object({
  setupToken: z.string().min(10),
  code: z.string().min(6).max(8),
  adminPassword: z.string().min(1),
});

export async function PUT(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = enableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Code und Passwort eingeben." }, { status: 400 });
  }
  const reauth = await requireAdminPassword(guard.user.id, parsed.data.adminPassword);
  if (!reauth.ok) return reauth.response;

  const token = verifyShortToken<{ uid: string; enc: string }>(parsed.data.setupToken, "totp-setup");
  if (!token || token.uid !== guard.user.id || typeof token.enc !== "string") {
    return NextResponse.json(
      { error: "Die Einrichtung ist abgelaufen. Bitte neu starten." },
      { status: 400 },
    );
  }
  const secret = decryptTotpSecret(token.enc);
  if (!verifyTotp(secret, parsed.data.code)) {
    return NextResponse.json(
      { error: "Der Code passt nicht. Bitte den aktuellen Code aus der App eingeben." },
      { status: 400 },
    );
  }

  await db
    .update(users)
    .set({ totpSecretEnc: token.enc, totpEnabledAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, guard.user.id));
  await logAdminAction({
    admin: { id: guard.user.id, email: guard.user.email },
    action: "totp.enable",
    targetType: "self",
    targetId: guard.user.id,
    req,
  });
  return NextResponse.json({ ok: true });
}

const disableSchema = z.object({
  code: z.string().min(6).max(8),
  adminPassword: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const parsed = disableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Code und Passwort eingeben." }, { status: 400 });
  }
  const reauth = await requireAdminPassword(guard.user.id, parsed.data.adminPassword);
  if (!reauth.ok) return reauth.response;

  const state = await loadTotpState(guard.user.id);
  if (!state?.totpSecretEnc || !state.totpEnabledAt) {
    return NextResponse.json({ error: "2FA ist nicht aktiv." }, { status: 400 });
  }
  if (!verifyTotp(decryptTotpSecret(state.totpSecretEnc), parsed.data.code)) {
    return NextResponse.json({ error: "Der Code ist falsch." }, { status: 400 });
  }

  await db
    .update(users)
    .set({ totpSecretEnc: null, totpEnabledAt: null, updatedAt: new Date() })
    .where(eq(users.id, guard.user.id));
  await logAdminAction({
    admin: { id: guard.user.id, email: guard.user.email },
    action: "totp.disable",
    targetType: "self",
    targetId: guard.user.id,
    req,
  });
  return NextResponse.json({ ok: true });
}
