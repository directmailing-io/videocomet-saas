/**
 * POST /api/contacts/dedupe-check
 *
 * Nimmt eine Batch von Kontakt-Zeilen (aus dem Wizard-Import) und prüft
 * dreistufig auf Duplikate. Rückgabe: pro Row ein Status plus Kontext
 * (bei "previously-contacted": Kampagne, Runde, Datum).
 *
 * Body: {
 *   rows: Array<{ email?, firstName?, lastName?, phone? }>,
 *   primaryKey?: "email" | "email_name" | "phone",
 *   contactedWithinDays?: number
 * }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { checkDuplicates, type PrimaryKeyMode } from "@/lib/contacts/dedupe-check";

const MAX_ROWS = 5000;

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const rawRows = Array.isArray(b.rows) ? b.rows : null;
  if (!rawRows) {
    return NextResponse.json(
      { error: "Bitte gib die Zeilen als Array unter 'rows' mit." },
      { status: 400 },
    );
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Zu viele Zeilen. Maximal ${MAX_ROWS} pro Anfrage.` },
      { status: 400 },
    );
  }

  const rows = rawRows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      email: typeof row.email === "string" ? row.email : null,
      firstName: typeof row.firstName === "string" ? row.firstName : null,
      lastName: typeof row.lastName === "string" ? row.lastName : null,
      phone: typeof row.phone === "string" ? row.phone : null,
    };
  });

  const pkRaw = typeof b.primaryKey === "string" ? b.primaryKey : "email";
  const primaryKey: PrimaryKeyMode =
    pkRaw === "email_name" || pkRaw === "phone" ? pkRaw : "email";
  const contactedWithinDays =
    typeof b.contactedWithinDays === "number" &&
    b.contactedWithinDays > 0 &&
    b.contactedWithinDays <= 365
      ? Math.floor(b.contactedWithinDays)
      : 90;

  try {
    const result = await checkDuplicates({
      userId: auth.user.id,
      rows,
      primaryKey,
      contactedWithinDays,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[dedupe-check] failed:", err);
    return NextResponse.json(
      {
        error: "Die Duplikat-Prüfung hat gerade nicht funktioniert. Bitte in einem Moment nochmal probieren.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
