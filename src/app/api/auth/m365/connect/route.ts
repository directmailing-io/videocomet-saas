export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/m365/connect — startet den Microsoft-OAuth-Flow.
 *
 * Redirect auf login.microsoftonline.com/common (Multi-Tenant) mit HMAC-
 * signiertem `state`. Fehlende MS-Env ⇒ 503 mit klarer Meldung (das UI
 * zeigt den Button dann gar nicht erst aktiv).
 */

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  buildAuthorizeUrl,
  isM365Configured,
  signOAuthState,
} from "@/lib/msgraph/client";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  if (!isM365Configured()) {
    return NextResponse.json(
      {
        error:
          "Die Microsoft-365-Anbindung ist auf diesem Server nicht konfiguriert (MS_CLIENT_ID / MS_CLIENT_SECRET fehlen). Bitte wenden Sie sich an den Support.",
      },
      { status: 503 },
    );
  }

  const state = signOAuthState(auth.user.id);
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
