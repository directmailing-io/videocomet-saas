/**
 * GET /api/contacts/v2 — Kontakt-Liste aus dem neuen contacts-Modell
 * (Migration 0054). Ersetzt schrittweise /api/contacts (das noch auf
 * dem alten leads-Aggregat läuft).
 *
 * Query-Parameter:
 *   listId       — Filter auf eine Liste (uuid). Ohne = alle Kontakte.
 *   search       — freie Textsuche (min 2 Zeichen).
 *   sort         — recent | name | activity (Default: activity)
 *   limit/offset — Pagination (Default 100 / 0, Max 500).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { countContacts, listContacts } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db";
import { contactLists } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { normalizeFilter } from "@/lib/contacts/filter";

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const listId = req.nextUrl.searchParams.get("listId") ?? null;
  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const sortParam = req.nextUrl.searchParams.get("sort");
  const sort =
    sortParam === "recent" || sortParam === "name" || sortParam === "activity"
      ? sortParam
      : "activity";
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? "100") || 100, 1),
    500,
  );
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") ?? "0") || 0, 0);

  // Smart-Listen: wenn listId auf eine type=smart-Liste zeigt, verwenden
  // wir statt der Membership-Prüfung den gespeicherten Filter.
  let effectiveListId: string | null = listId;
  let smartFilter = null;
  if (listId) {
    const [list] = await db
      .select({ type: contactLists.type, smartFilter: contactLists.smartFilter })
      .from(contactLists)
      .where(and(eq(contactLists.id, listId), eq(contactLists.userId, auth.user.id)))
      .limit(1);
    if (list?.type === "smart" && list.smartFilter) {
      smartFilter = normalizeFilter(list.smartFilter);
      effectiveListId = null; // Membership-Filter aus, Filter-Query rein
    }
  }

  const [result, totalAll] = await Promise.all([
    listContacts({
      userId: auth.user.id,
      listId: effectiveListId,
      search: search?.trim() || undefined,
      sort,
      limit,
      offset,
      filter: smartFilter,
    }),
    countContacts(auth.user.id),
  ]);

  return NextResponse.json({
    contacts: result.contacts,
    total: result.total,
    totalAll,
  });
}
