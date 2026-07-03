export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { listContacts } from "@/lib/leads/global-list";

/**
 * GET /api/contacts?search=...&limit=50&offset=0
 * Liefert die globale Kontakt-Liste des Users mit Duplikat-Konsolidierung.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

  const result = await listContacts({
    userId: auth.user.id,
    search: search?.trim() || undefined,
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return NextResponse.json(result);
}
