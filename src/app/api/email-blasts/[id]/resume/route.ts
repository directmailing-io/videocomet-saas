export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { resumeEmailBlast, serializeEmailBlast } from "@/lib/db/queries/email-blasts";

/** POST /api/email-blasts/[id]/resume — paused ⇒ running. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const result = await resumeEmailBlast(params.id, auth.user.id);
  if (!result.ok) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Nur pausierte Blasts können fortgesetzt werden." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, blast: serializeEmailBlast(result.blast) });
}
