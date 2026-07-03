export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getXlsxTabs } from "@/lib/excel-parse";

/**
 * POST /api/excel/tabs
 *
 * multipart/form-data:
 *   - file: xlsx Datei
 *
 * Listet alle Sheets/Tabs eines Excel-Workbooks — Name, Zeilenzahl,
 * Spaltenzahl. Wird vom Runden-Wizard genutzt, damit der User bei
 * Multi-Sheet-Workbooks waehlen kann welche Tabs verarbeitet werden.
 *
 * Nutzt bookSheets-Mode (keine Cells geladen) → schnell auch bei 50MB-Files.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data erwartet." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const tabs = getXlsxTabs(buf);
    return NextResponse.json({ tabs });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Datei konnte nicht gelesen werden.",
      },
      { status: 400 },
    );
  }
}
