export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  extractSheetsId,
  getSheetsClient,
  isDriveRendererConfigured,
} from "@/lib/google-docs/sa-auth";

/**
 * GET /api/google-sheets/tabs?url=<google-sheets-url>
 *
 * Listet alle Tabs eines Google-Spreadsheets — Titel, gid, Zeilenzahl,
 * Sichtbarkeit. Wird vom Runden-Wizard genutzt, damit der User bei
 * Multi-Tab-Sheets waehlen kann welche Tabs verarbeitet werden.
 *
 * Read-only, ein einziger `spreadsheets.get`-Call mit fields-Filter →
 * kein Zell-Content geladen, extrem quotenschonend. Rate-Limit bei
 * Google: 60 read/min/user, das reicht auch fuer 40-Tab-Sheets locker.
 *
 * Auth: Sheet muss entweder public geshared sein (Anyone-with-link) ODER
 * mit der Service-Account-Email geteilt sein.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url fehlt" }, { status: 400 });
  }

  const { spreadsheetId, gid: activeGid } = extractSheetsId(url);
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "Keine gueltige Google-Sheets-URL." },
      { status: 400 },
    );
  }

  if (!isDriveRendererConfigured()) {
    return NextResponse.json(
      {
        error:
          "Service-Account nicht konfiguriert (GOOGLE_DRIVE_SA_KEY fehlt).",
      },
      { status: 500 },
    );
  }

  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      // Nur Metadata, keine Cells. `hidden` ist bei manchen Sheets undefined
      // (nicht gesetzt = false), deshalb behandeln wir es defensiv.
      fields:
        "properties.title,sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))",
    });

    const spreadsheetTitle = res.data.properties?.title ?? "Unbenannt";
    const tabs = (res.data.sheets ?? [])
      .map((s) => {
        const p = s.properties;
        if (!p) return null;
        const rowCount = p.gridProperties?.rowCount ?? 0;
        // Google reserviert immer ein Grid mit mind. 1000 leeren Zeilen —
        // "rowCount" ist die Grid-Kapazitaet, nicht die genutzten Zeilen.
        // Fuer den User zeigen wir die Grid-Groesse als grobe Orientierung.
        return {
          gid: p.sheetId ?? 0,
          title: p.title ?? "Unbenannt",
          index: p.index ?? 0,
          hidden: p.hidden === true,
          rowCount,
          columnCount: p.gridProperties?.columnCount ?? 0,
          isActive: p.sheetId === activeGid,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => a.index - b.index);

    return NextResponse.json({
      spreadsheetId,
      spreadsheetTitle,
      activeGid,
      tabs,
    });
  } catch (err: unknown) {
    // Google-API-Fehler haben oft strukturierte Codes — 403/404 = access-denied,
    // 429 = rate-limit, 5xx = transient. Wir mappen auf lesbare Meldungen.
    const status =
      err && typeof err === "object" && "code" in err
        ? Number((err as { code: unknown }).code)
        : 0;
    if (status === 403 || status === 404) {
      return NextResponse.json(
        {
          error:
            "Kein Zugriff auf dieses Sheet. Bitte auf 'Jeder mit Link' teilen oder unsere Service-Account-Email einladen.",
        },
        { status: 403 },
      );
    }
    if (status === 429) {
      return NextResponse.json(
        {
          error:
            "Zu viele Anfragen an Google Sheets. Bitte in ein paar Sekunden nochmal.",
        },
        { status: 429 },
      );
    }
    console.error("[google-sheets:tabs]", err);
    return NextResponse.json(
      {
        error:
          "Tabs konnten nicht geladen werden. Bitte URL pruefen und nochmal.",
      },
      { status: 500 },
    );
  }
}
