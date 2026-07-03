export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getContactFilterOptions, listContacts, type ContactSort } from "@/lib/leads/global-list";

/**
 * GET /api/contacts?search=...&limit=50&offset=0
 * Liefert die globale Kontakt-Liste des Users mit Duplikat-Konsolidierung.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const sort = req.nextUrl.searchParams.get("sort") as ContactSort | null;
  const duplicatesOnly = req.nextUrl.searchParams.get("duplicatesOnly") === "1";
  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? undefined;
  const withOptions = req.nextUrl.searchParams.get("withOptions") === "1";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

  const result = await listContacts({
    userId: auth.user.id,
    search: search?.trim() || undefined,
    sort: sort ?? undefined,
    duplicatesOnly,
    campaignId: campaignId?.trim() || undefined,
    limit: Number.isFinite(limit) ? limit : 100,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  if (withOptions) {
    const options = await getContactFilterOptions(auth.user.id);
    return NextResponse.json({ ...result, options });
  }
  return NextResponse.json(result);
}
