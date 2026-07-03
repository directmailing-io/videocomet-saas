export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, runs } from "@/lib/db/schema";
import { parseCSV } from "@/lib/csv-parse";
import { parseXLSX } from "@/lib/excel-parse";
import { fetchGoogleSheetCsv } from "@/lib/google-sheets";

const MAX_ROWS_PER_TAB = 5000;

const TabSchema = z.object({
  runName: z.string().trim().min(1).max(200),
  // Google Sheets identification
  gid: z.number().int().nonnegative().optional(),
  // Excel identification
  sheetName: z.string().optional(),
  // Anzeige-Titel (Tab-Name oder Datei-Name für csv)
  tabTitle: z.string().trim().min(1).max(200),
});

const SourceSchema = z.union([
  z.object({
    type: z.literal("google-sheets"),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("xlsx"),
  }),
  z.object({
    type: z.literal("csv"),
  }),
]);

const PayloadSchema = z.object({
  campaignId: z.string().uuid(),
  source: SourceSchema,
  tabs: z.array(TabSchema).min(1).max(20),
  // Shared mapping über alle Tabs.
  mapping: z.record(z.string(), z.string()).optional(),
  placeholderMapping: z.record(z.string(), z.unknown()).optional(),
  dedupeConfig: z.record(z.string(), z.unknown()).optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

/**
 * POST /api/runs/bulk
 *
 * Erstellt in einem Zug N Draft-Runden aus einer Multi-Tab-Quelle.
 * - Google Sheets: JSON-Body, pro Tab wird `/export?format=csv&gid=<GID>` gefetcht.
 * - Excel:         multipart mit `file` + `payload`-Feld, pro Tab wird
 *                  parseXLSX(buf, sheetName) aufgerufen.
 * - CSV:           multipart mit `file` + `payload`-Feld, ein einziger "Tab"
 *                  (die ganze Datei).
 *
 * Der Endpoint macht KEIN start — er persistiert nur Draft-Runden mit
 * parsed rows + mapping. Der Client ruft danach `/api/runs/[id]/start`
 * pro Runde, damit die bestehende Billing/Preflight-Logik unangetastet bleibt.
 *
 * Return: { runs: [{id, name, tabTitle, leadCount}] }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Content-Type entscheidet: Google Sheets = JSON, sonst multipart.
  const contentType = req.headers.get("content-type") ?? "";
  let payload: Payload;
  let fileBuffer: Buffer | null = null;

  if (contentType.includes("application/json")) {
    const raw = await req.json().catch(() => null);
    const parsed = PayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
        { status: 400 },
      );
    }
    payload = parsed.data;
    if (payload.source.type !== "google-sheets") {
      return NextResponse.json(
        { error: "JSON body ist nur fuer google-sheets erlaubt." },
        { status: 400 },
      );
    }
  } else {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "multipart/form-data erwartet." },
        { status: 400 },
      );
    }
    const raw = form.get("payload");
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "payload fehlt." }, { status: 400 });
    }
    const parsed = PayloadSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungueltiger Payload" },
        { status: 400 },
      );
    }
    payload = parsed.data;
    if (payload.source.type === "google-sheets") {
      return NextResponse.json(
        { error: "google-sheets erwartet JSON-body ohne file." },
        { status: 400 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
    }
    fileBuffer = Buffer.from(await file.arrayBuffer());
  }

  // Campaign gehoert dem User?
  const [camp] = await db
    .select({ id: campaigns.id, mode: campaigns.mode })
    .from(campaigns)
    .where(and(eq(campaigns.id, payload.campaignId), eq(campaigns.userId, auth.user.id)))
    .limit(1);
  if (!camp) {
    return NextResponse.json(
      { error: "Kampagne nicht gefunden." },
      { status: 404 },
    );
  }

  // Content pro Tab laden. Wir laden strikt sequentiell — 5 parallele Fetches
  // an Google Sheets sind noch OK, aber wir halten's simpler.
  interface ParsedTab {
    tabTitle: string;
    runName: string;
    gid?: number;
    sheetName?: string;
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
  }
  const parsedTabs: ParsedTab[] = [];
  try {
    for (const tab of payload.tabs) {
      let headers: string[];
      let rows: Record<string, string>[];
      let totalRows: number;
      if (payload.source.type === "google-sheets") {
        // Baue URL mit spezifischem gid und fetche
        const buf = await fetchGoogleSheetCsvByGid(payload.source.url, tab.gid);
        const out = parseCSV(buf);
        headers = out.headers;
        rows = out.rows;
        totalRows = out.rows.length;
      } else if (payload.source.type === "xlsx") {
        if (!fileBuffer) throw new Error("Datei fehlt.");
        if (!tab.sheetName) throw new Error("sheetName fehlt fuer xlsx-Tab.");
        const out = parseXLSX(fileBuffer, tab.sheetName);
        headers = out.headers;
        rows = out.rows;
        totalRows = out.rows.length;
      } else {
        // CSV — nur ein Tab erwartet
        if (!fileBuffer) throw new Error("Datei fehlt.");
        const out = parseCSV(fileBuffer);
        headers = out.headers;
        rows = out.rows;
        totalRows = out.rows.length;
      }
      parsedTabs.push({
        tabTitle: tab.tabTitle,
        runName: tab.runName,
        gid: tab.gid,
        sheetName: tab.sheetName,
        headers,
        rows,
        totalRows,
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Ein Tab konnte nicht geladen werden.",
      },
      { status: 400 },
    );
  }

  // Header-Konsistenz-Check: alle Tabs muessen dieselben Spalten haben,
  // sonst kann ein Mapping nicht auf alle passen.
  if (parsedTabs.length > 1) {
    const baseline = new Set(parsedTabs[0].headers.map((h) => h.trim()));
    for (const tab of parsedTabs.slice(1)) {
      const cols = new Set(tab.headers.map((h) => h.trim()));
      const missing = Array.from(baseline).filter((c) => !cols.has(c));
      const extra = Array.from(cols).filter((c) => !baseline.has(c));
      if (missing.length > 0 || extra.length > 0) {
        return NextResponse.json(
          {
            error:
              "Tabs haben unterschiedliche Spalten. Alle ausgewaehlten Tabs muessen dieselben Spalten haben.",
            details: {
              tab: tab.tabTitle,
              missing,
              extra,
            },
          },
          { status: 400 },
        );
      }
    }
  }

  // Leere Tabs rausfiltern? Nein — der User hat sie bewusst gewaehlt,
  // wir erstellen die Runde trotzdem (im Draft-Status, damit sie sichtbar
  // ist und der User weiss dass sie leer waren).

  const sourceType = payload.source.type;
  const sourceUrl = payload.source.type === "google-sheets" ? payload.source.url : null;

  // In einer Transaktion N Runden anlegen und ihre parsed rows + mapping speichern.
  const created = await db.transaction(async (tx) => {
    const out: Array<{ id: string; name: string; tabTitle: string; leadCount: number }> = [];
    for (const tab of parsedTabs) {
      const columnMapping = {
        mapping: payload.mapping ?? {},
        placeholderMapping: payload.placeholderMapping ?? undefined,
        parsed: {
          headers: tab.headers,
          rows: tab.rows.slice(0, MAX_ROWS_PER_TAB),
          totalRows: tab.totalRows,
          source: sourceType,
        },
      };
      const [row] = await tx
        .insert(runs)
        .values({
          userId: auth.user.id,
          campaignId: payload.campaignId,
          name: tab.runName,
          status: "draft",
          columnMapping: columnMapping as unknown as Record<string, string>,
          // Drizzle-Typ ist der schema-DedupeConfig mit index signature.
          // payload.dedupeConfig kommt aus zod-parse (Record<string,unknown>),
          // wir vertrauen dem Wizard's shape und casten via unknown.
          dedupeConfig: (payload.dedupeConfig ?? null) as unknown as never,
          sourceType,
          sourceUrl,
          sourceTabGid: tab.gid ?? null,
          sourceTabTitle: tab.tabTitle,
        })
        .returning({ id: runs.id, name: runs.name });
      out.push({
        id: row.id,
        name: row.name,
        tabTitle: tab.tabTitle,
        leadCount: tab.totalRows,
      });
    }
    return out;
  });

  return NextResponse.json({ runs: created }, { status: 200 });
}

/**
 * Baut die CSV-Export-URL mit spezifischem gid und laedt sie via existierende
 * Public-Fetch-Helferfunktion. Wir wollen NICHT auf fetchGoogleSheetCsv(url)
 * angewiesen sein, das die gid aus der URL parst — wir uebergeben explizit.
 */
async function fetchGoogleSheetCsvByGid(
  originalUrl: string,
  gid: number | undefined,
): Promise<Buffer> {
  // fetchGoogleSheetCsv extrahiert die gid selbst aus der URL. Wir bauen
  // eine URL mit dem gewuenschten gid als Query-Parameter, damit die
  // Extraktions-Regex ihn findet.
  const idMatch = originalUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    throw new Error("Ungueltige Google-Sheets-URL.");
  }
  const spreadsheetId = idMatch[1];
  const gidPart = gid !== undefined ? `?gid=${gid}` : "";
  const rebuilt = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gidPart}`;
  return fetchGoogleSheetCsv(rebuilt);
}
