export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/m365/callback — Microsoft-OAuth-Rückweg.
 *
 * Code-Exchange → /me lesen → Upsert mailbox_connections (Refresh-Token
 * verschlüsselt). AADSTS65001 (User-Consent im Tenant gesperrt) ⇒ Redirect
 * auf die Einstellungen mit `?m365Error=admin_consent`, wo das UI den
 * fertigen Admin-Consent-Link anzeigt.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/auth";
import { encryptMailboxSecret } from "@/lib/mailbox/crypto";
import { upsertM365Mailbox } from "@/lib/db/queries/mailboxes";
import {
  M365AuthError,
  exchangeCodeForTokens,
  fetchMe,
  getAppBaseUrl,
  isM365Configured,
  verifyOAuthState,
} from "@/lib/msgraph/client";

function settingsRedirect(params: Record<string, string>): NextResponse {
  const url = new URL("/einstellungen", getAppBaseUrl());
  url.searchParams.set("tab", "postfaecher");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isM365Configured()) {
    return settingsRedirect({ m365Error: "not_configured" });
  }

  const search = req.nextUrl.searchParams;
  const oauthError = search.get("error");
  const description = search.get("error_description") ?? "";

  if (oauthError) {
    if (
      description.includes("AADSTS65001") ||
      oauthError === "consent_required"
    ) {
      return settingsRedirect({ m365Error: "admin_consent" });
    }
    if (oauthError === "access_denied") {
      return settingsRedirect({ m365Error: "denied" });
    }
    return settingsRedirect({ m365Error: "failed" });
  }

  const code = search.get("code");
  const stateRaw = search.get("state");
  if (!code || !stateRaw) {
    return settingsRedirect({ m365Error: "failed" });
  }

  const state = verifyOAuthState(stateRaw);
  if (!state) {
    return settingsRedirect({ m365Error: "failed" });
  }

  const { user } = await validateRequest();
  if (!user || user.id !== state.userId) {
    return settingsRedirect({ m365Error: "failed" });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const me = await fetchMe(tokens.accessToken);
    await upsertM365Mailbox({
      userId: user.id,
      emailAddress: me.email,
      displayName: me.displayName,
      refreshTokenEncrypted: encryptMailboxSecret(tokens.refreshToken),
    });
    return settingsRedirect({ m365: "connected" });
  } catch (err) {
    if (
      err instanceof M365AuthError &&
      err.message.includes("AADSTS65001")
    ) {
      return settingsRedirect({ m365Error: "admin_consent" });
    }
    console.error("[m365/callback] Verbindung fehlgeschlagen:", err);
    return settingsRedirect({ m365Error: "failed" });
  }
}
