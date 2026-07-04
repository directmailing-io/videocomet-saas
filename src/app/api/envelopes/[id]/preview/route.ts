export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { envelopeTemplates } from "@/lib/db/schema";
import { generateEnvelopePdf } from "@/worker/lib/envelope-pdf";

/**
 * GET /api/envelopes/[id]/preview
 *
 * Erzeugt ein Preview-PDF mit Beispiel-Daten (Max Mustermann etc.).
 * Fuer den Editor: der User klickt "Vorschau" und sieht sofort wie
 * ein befuellter Umschlag aussieht.
 */
const SAMPLE_DATA: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  street: "Beispielstraße 42",
  zip: "10115",
  city: "Berlin",
  company: "Muster GmbH",
  email: "max@muster.de",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [tpl] = await db
    .select()
    .from(envelopeTemplates)
    .where(
      and(
        eq(envelopeTemplates.id, params.id),
        eq(envelopeTemplates.userId, auth.user.id),
        isNull(envelopeTemplates.deletedAt),
      ),
    )
    .limit(1);

  if (!tpl) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const pdf = await generateEnvelopePdf({
    format: tpl.format,
    fields: tpl.fields,
    sender: tpl.sender,
    recipientData: SAMPLE_DATA,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="preview.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
