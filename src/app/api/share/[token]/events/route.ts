/**
 * Public-Endpoint (cookie-auth): Liefert den Event-Stream einer per Share-
 * Token freigeschalteten Kampagne. Polling-Endpoint für das Share-UI.
 *
 * Auth:
 *   - HttpOnly signed cookie `vc_share_<tokenPrefix>` (siehe /auth route).
 *   - 401, wenn Cookie fehlt / abgelaufen / HMAC mismatched / Token≠Cookie.
 *
 * Query-Parameter:
 *   - `since`  ISO-Datum; nur neuere Events. Default = kein Filter.
 *   - `limit`  1..500, default 200.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getActiveShareByToken,
  listShareEvents,
} from "@/lib/db/queries/campaign-shares";
import {
  cookieName,
  requireShareCookieSecret,
  verifyShareCookie,
} from "@/lib/share-cookie";

// Validiert das Secret beim Modul-Load — siehe /auth/route.ts.
requireShareCookieSecret();

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Ungültiger Link." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName(token))?.value;
  if (!verifyShareCookie(token, raw)) {
    return NextResponse.json(
      { error: "Sitzung abgelaufen." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // Token im Cookie ist verifiziert → wir holen die Share-Row für
  // Tenant-Scoping (campaignId). Falls der Share zwischendurch revoked
  // wurde, geben wir 401 zurück (statt 404), damit das Frontend einen
  // Re-Login auslöst.
  const share = await getActiveShareByToken(token);
  if (!share) {
    return NextResponse.json(
      { error: "Link nicht mehr aktiv." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const sinceParam = req.nextUrl.searchParams.get("since");
  const limitParam = req.nextUrl.searchParams.get("limit");

  let sinceTs: Date | undefined;
  if (sinceParam) {
    const t = Date.parse(sinceParam);
    if (Number.isFinite(t)) {
      sinceTs = new Date(t);
    }
  }
  let limit: number | undefined;
  if (limitParam) {
    const n = Number.parseInt(limitParam, 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }

  const events = await listShareEvents(share.campaignId, { sinceTs, limit });

  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
