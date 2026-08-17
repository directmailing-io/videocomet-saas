/**
 * POST /api/contacts/v2/filter
 *
 * Führt einen Ad-hoc-Filter gegen die Kontakte des Users aus. Wird von der
 * Filter-Bar in /kontakte aufgerufen (Live-Vorschau + "Als Liste speichern").
 *
 * Body: { filter: FilterDefinition, listId?: string, limit?: number, sort?: ... }
 *   `listId` — zusätzliche Einschränkung auf eine Liste (Filter INNERHALB einer Liste).
 *
 * Response: { contacts, total, totalAll }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { countContacts, listContacts } from "@/lib/db/queries/contacts";
import { normalizeFilter } from "@/lib/contacts/filter";

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const filter = normalizeFilter(body.filter);
  const listId = typeof body.listId === "string" ? body.listId : null;
  const search = typeof body.search === "string" ? body.search : undefined;
  const sortParam = body.sort;
  const sort =
    sortParam === "recent" || sortParam === "name" || sortParam === "activity"
      ? sortParam
      : "activity";
  const limit = Math.min(
    Math.max(Number(body.limit ?? 500) || 500, 1),
    2000,
  );
  const offset = Math.max(Number(body.offset ?? 0) || 0, 0);

  try {
    const [result, totalAll] = await Promise.all([
      listContacts({
        userId: auth.user.id,
        listId,
        search: search?.trim() || undefined,
        sort,
        limit,
        offset,
        filter,
      }),
      countContacts(auth.user.id),
    ]);
    return NextResponse.json({
      contacts: result.contacts,
      total: result.total,
      totalAll,
    });
  } catch (err) {
    console.error("[api/contacts/v2/filter] failed:", err);
    return NextResponse.json(
      { error: "Filter konnte nicht ausgewertet werden.", details: err instanceof Error ? err.message : null },
      { status: 500 },
    );
  }
}
