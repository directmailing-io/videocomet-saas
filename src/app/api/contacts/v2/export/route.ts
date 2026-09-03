export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  contacts,
  contactLists,
  listMemberships,
  leads,
  runs,
  campaigns,
  leadEvents,
  emailMessages,
} from "@/lib/db/schema";
import { getUserDomain } from "@/lib/db/queries/user-domains";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { progressLabel } from "@/lib/activity/video-progress-label";

/**
 * POST /api/contacts/v2/export
 *
 * Exportiert ausgewählte Kontakte als Excel (2 Blätter) oder CSV.
 *
 *   Excel:  „Kontakte & Kampagnen" — eine Tabelle: Stammdaten + Custom-
 *                                    Felder + Listen + pro Kampagnen-
 *                                    Teilnahme (Lead) Brief-/E-Mail-Status
 *                                    und Landingpage-Links MIT und OHNE
 *                                    Vorschau
 *           „Aktivitäten"          — komplettes Ereignis-Protokoll (deutsch)
 *
 *   CSV:    flach — eine Zeile pro Kampagnen-Teilnahme, Kontaktdaten
 *           wiederholt; Kontakte ohne Kampagne bekommen eine Zeile mit
 *           leeren Kampagnen-Spalten. Format: UTF-8 mit BOM, Semikolon
 *           als Trenner, CRLF — öffnet sich in deutschem Excel korrekt.
 *
 * Body: { contactIds: string[], format: "csv" | "xlsx" }
 */

const MAX_CONTACTS = 2000;
const MAX_EVENT_ROWS = 20000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  let body: { contactIds?: unknown; format?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const format = body.format === "csv" ? "csv" : "xlsx";
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter(
        (id): id is string => typeof id === "string" && UUID_RE.test(id),
      )
    : [];
  if (contactIds.length === 0) {
    return NextResponse.json(
      { error: "Keine Kontakte ausgewählt." },
      { status: 400 },
    );
  }
  if (contactIds.length > MAX_CONTACTS) {
    return NextResponse.json(
      { error: `Maximal ${MAX_CONTACTS} Kontakte pro Export.` },
      { status: 400 },
    );
  }

  const idsSql = sql.join(
    contactIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // ── 1) Stammdaten ────────────────────────────────────────────────────
  const contactRows = await db.execute<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    company_display: string | null;
    phone: string | null;
    linkedin_url: string | null;
    salutation: string | null;
    title: string | null;
    external_id: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    position: string | null;
    website: string | null;
    gender: string | null;
    data: Record<string, string>;
    created_at: string;
    last_activity_at: string | null;
  }>(sql`
    SELECT c.id, c.email, c.first_name, c.last_name, c.company,
           c.company_display, c.phone, c.linkedin_url, c.salutation,
           c.title, c.external_id, c.street, c.postal_code, c.city,
           c.country, c.position, c.website, c.gender, c.data,
           c.created_at, c.last_activity_at
    FROM ${contacts} c
    WHERE c.user_id = ${userId}
      AND c.deleted_at IS NULL
      AND c.id = ANY(ARRAY[${idsSql}])
    ORDER BY c.last_name NULLS LAST, c.first_name NULLS LAST, c.created_at
  `);
  if (contactRows.length === 0) {
    return NextResponse.json(
      { error: "Keine Kontakte gefunden." },
      { status: 404 },
    );
  }
  const foundIds = contactRows.map((c) => c.id);
  const foundIdsSql = sql.join(
    foundIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // ── 2) Listen-Zugehörigkeit ──────────────────────────────────────────
  const listRows = await db.execute<{ contact_id: string; name: string }>(sql`
    SELECT lm.contact_id, cl.name
    FROM ${listMemberships} lm
    JOIN ${contactLists} cl ON cl.id = lm.list_id
    WHERE lm.contact_id = ANY(ARRAY[${foundIdsSql}])
    ORDER BY cl.name ASC
  `);
  const listsByContact = new Map<string, string[]>();
  for (const r of listRows) {
    const arr = listsByContact.get(r.contact_id) ?? [];
    arr.push(r.name);
    listsByContact.set(r.contact_id, arr);
  }

  // ── 3) Kampagnen-Teilnahmen (Leads) inkl. E-Mail-Aggregat ────────────
  const occRows = await db.execute<{
    lead_id: string;
    contact_id: string;
    campaign_name: string;
    domain_id: string | null;
    run_name: string;
    status: string;
    slug: string | null;
    created_at: string;
    completed_at: string | null;
    view_count: number;
    play_count: number;
    cta_click_count: number;
    last_viewed_at: string | null;
    last_cta_at: string | null;
    letter_status: string;
    letter_sent_at: string | null;
    mails_sent: number;
    last_mail_at: string | null;
    replied: boolean;
  }>(sql`
    SELECT l.id AS lead_id, l.contact_id, c.name AS campaign_name,
           c.domain_id, r.name AS run_name, l.status, l.slug,
           l.created_at, l.completed_at,
           l.view_count, l.play_count, l.cta_click_count,
           l.last_viewed_at, l.last_cta_at,
           l.letter_status, l.letter_sent_at,
           COALESCE(em.mails_sent, 0)::int AS mails_sent,
           em.last_mail_at,
           COALESCE(em.replied, false) AS replied
    FROM ${leads} l
    JOIN ${runs} r ON r.id = l.run_id
    JOIN ${campaigns} c ON c.id = l.campaign_id
    LEFT JOIN (
      SELECT lead_id,
             COUNT(*) FILTER (WHERE status = 'sent') AS mails_sent,
             MAX(sent_at) AS last_mail_at,
             BOOL_OR(replied_at IS NOT NULL) AS replied
      FROM ${emailMessages}
      GROUP BY lead_id
    ) em ON em.lead_id = l.id
    WHERE l.contact_id = ANY(ARRAY[${foundIdsSql}])
      AND l.removed_at IS NULL
    ORDER BY l.created_at DESC
  `);
  type OccRow = (typeof occRows)[number];
  const occByContact = new Map<string, OccRow[]>();
  for (const r of occRows) {
    const arr = occByContact.get(r.contact_id) ?? [];
    arr.push(r);
    occByContact.set(r.contact_id, arr);
  }

  // ── 4) Aktivitäten-Protokoll ─────────────────────────────────────────
  const eventRows = await db.execute<{
    contact_id: string;
    campaign_name: string;
    run_name: string;
    kind: string;
    ts: string;
    payload: Record<string, unknown> | null;
  }>(sql`
    SELECT l.contact_id, c.name AS campaign_name, r.name AS run_name,
           le.kind, le.ts, le.payload
    FROM ${leadEvents} le
    JOIN ${leads} l ON l.id = le.lead_id
    JOIN ${runs} r ON r.id = l.run_id
    JOIN ${campaigns} c ON c.id = l.campaign_id
    WHERE l.contact_id = ANY(ARRAY[${foundIdsSql}])
    ORDER BY le.ts DESC
    LIMIT ${MAX_EVENT_ROWS}
  `);

  // ── 5) Custom-Domains auflösen (pro Kampagne) ────────────────────────
  const domainIds = Array.from(
    new Set(occRows.map((r) => r.domain_id).filter((d): d is string => !!d)),
  );
  const hostnameByDomain = new Map<string, string>();
  for (const domainId of domainIds) {
    try {
      const d = await getUserDomain(domainId, userId);
      if (d && d.status === "active") hostnameByDomain.set(domainId, d.hostname);
    } catch {
      // Fallback: Default-App-URL
    }
  }
  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // ── Zeilen bauen ─────────────────────────────────────────────────────
  const customCols = collectDataColumns(contactRows.map((c) => c.data ?? {}));

  const contactBase = (c: (typeof contactRows)[number]) => [
    c.salutation ?? "",
    c.title ?? "",
    c.first_name ?? "",
    c.last_name ?? "",
    c.company_display || c.company || "",
    c.position ?? "",
    c.email ?? "",
    c.phone ?? "",
    c.street ?? "",
    c.postal_code ?? "",
    c.city ?? "",
    c.country ?? "",
    c.website ?? "",
    c.linkedin_url ?? "",
    c.external_id ?? "",
    (listsByContact.get(c.id) ?? []).join(", "),
  ];
  const contactBaseHeaders = [
    "Anrede",
    "Titel",
    "Vorname",
    "Nachname",
    "Firma",
    "Position",
    "E-Mail",
    "Telefon",
    "Straße",
    "PLZ",
    "Ort",
    "Land",
    "Website",
    "LinkedIn",
    "Externe ID",
    "Listen",
  ];

  const occCells = (o: (typeof occRows)[number]) => {
    const hostname = o.domain_id
      ? (hostnameByDomain.get(o.domain_id) ?? null)
      : null;
    const urlInput = {
      slug: o.slug,
      customHostname: hostname,
      defaultAppUrl: appUrl,
    };
    return [
      o.campaign_name,
      o.run_name,
      LEAD_STATUS_DE[o.status] ?? o.status,
      fmtDate(o.created_at),
      fmtDate(o.completed_at),
      o.view_count,
      o.play_count,
      o.cta_click_count,
      fmtDate(o.last_viewed_at),
      fmtDate(o.last_cta_at),
      LETTER_STATUS_DE[o.letter_status] ?? o.letter_status,
      fmtDate(o.letter_sent_at),
      o.mails_sent,
      fmtDate(o.last_mail_at),
      o.replied ? "Ja" : "Nein",
      buildLeadPublicUrl(urlInput, { absolute: true }) ?? "",
      buildLeadPublicUrl(urlInput, { absolute: true, preview: true }) ?? "",
    ];
  };
  const occHeaders = [
    "Kampagne",
    "Runde",
    "Video-Status",
    "Aufgenommen am",
    "Video fertig am",
    "Seitenaufrufe",
    "Video-Starts",
    "CTA-Klicks",
    "Zuletzt angesehen",
    "Letzter CTA-Klick",
    "Brief-Status",
    "Brief versendet am",
    "E-Mails gesendet",
    "Letzte E-Mail am",
    "E-Mail-Antwort erhalten",
    "Landingpage-Link",
    "Landingpage-Link (Vorschau, ohne Tracking)",
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const filenameBase = `videocomet-kontakte-${stamp}`;

  if (format === "csv") {
    // Flach: Kontakt × Kampagnen-Teilnahme. Ohne Teilnahme ⇒ eine Zeile
    // mit leeren Kampagnen-Spalten, damit kein Kontakt verloren geht.
    const headers = [
      ...contactBaseHeaders,
      ...customCols,
      ...occHeaders,
      "Kontakt angelegt am",
      "Letzte Aktivität am",
    ];
    const rows: Array<Array<string | number>> = [];
    for (const c of contactRows) {
      const base = [
        ...contactBase(c),
        ...customCols.map((k) => c.data?.[k] ?? ""),
      ];
      const tail = [fmtDate(c.created_at), fmtDate(c.last_activity_at)];
      const occs = occByContact.get(c.id) ?? [];
      if (occs.length === 0) {
        rows.push([...base, ...occHeaders.map(() => ""), ...tail]);
      } else {
        for (const o of occs) {
          rows.push([...base, ...occCells(o), ...tail]);
        }
      }
    }
    const csv = toCsv([headers, ...rows]);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Excel: 2 Blätter ─────────────────────────────────────────────────
  // Blatt 1 vereint Kontakte + Kampagnen + Links: eine Zeile pro
  // Kampagnen-Teilnahme, Kontaktdaten wiederholt; Kontakte ohne Kampagne
  // bekommen eine Zeile mit leeren Kampagnen-Spalten.
  const wb = XLSX.utils.book_new();

  const sheet1Rows: Array<Array<string | number>> = [
    [
      "Nr.",
      ...contactBaseHeaders,
      ...customCols,
      ...occHeaders,
      "Kontakt angelegt am",
      "Letzte Aktivität am",
    ],
  ];
  contactRows.forEach((c, i) => {
    const base = [
      i + 1,
      ...contactBase(c),
      ...customCols.map((k) => c.data?.[k] ?? ""),
    ];
    const tail = [fmtDate(c.created_at), fmtDate(c.last_activity_at)];
    const occs = occByContact.get(c.id) ?? [];
    if (occs.length === 0) {
      sheet1Rows.push([...base, ...occHeaders.map(() => ""), ...tail]);
    } else {
      for (const o of occs) {
        sheet1Rows.push([...base, ...occCells(o), ...tail]);
      }
    }
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sheet1Rows),
    "Kontakte & Kampagnen",
  );

  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const sheet3Rows: Array<Array<string | number>> = [
    ["Zeitpunkt", "Vorname", "Nachname", "Firma", "Kampagne", "Runde", "Aktivität"],
  ];
  for (const e of eventRows) {
    const c = contactById.get(e.contact_id);
    if (!c) continue;
    sheet3Rows.push([
      fmtDate(e.ts),
      c.first_name ?? "",
      c.last_name ?? "",
      c.company_display || c.company || "",
      e.campaign_name,
      e.run_name,
      describeEventDe(e.kind, e.payload),
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sheet3Rows),
    "Aktivitäten",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Union aller data-Keys in Einfüge-Reihenfolge. */
function collectDataColumns(datas: Array<Record<string, string>>): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const d of datas) {
    for (const k of Object.keys(d ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

/** de-DE Datum+Uhrzeit, leer bei NULL. */
function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d);
}

/**
 * CSV nach deutschen Excel-Regeln: Semikolon-Trenner, CRLF, UTF-8 mit
 * BOM, Felder mit Sonderzeichen in Anführungszeichen.
 */
function toCsv(rows: Array<Array<string | number>>): string {
  const esc = (v: string | number): string => {
    const s = String(v ?? "");
    if (/[";\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const body = rows.map((r) => r.map(esc).join(";")).join("\r\n");
  // BOM, damit Excel die Datei als UTF-8 erkennt (Umlaute!).
  return "\uFEFF" + body + "\r\n";
}

const LEAD_STATUS_DE: Record<string, string> = {
  pending: "Wartet",
  queued: "Wartet",
  processing: "In Arbeit",
  completed: "Fertig",
  failed: "Fehlgeschlagen",
};

const LETTER_STATUS_DE: Record<string, string> = {
  open: "Offen",
  in_progress: "In Bearbeitung",
  sent: "Versendet",
  discarded: "Aussortiert",
};

/**
 * Deutsche Klartext-Beschreibung eines Events — Server-Pendant zu
 * describeKind in aktivitaet/_components/event-icon.tsx (dort "use
 * client", hier bewusst kompakt dupliziert). Niemals rohe englische
 * Kinds ausgeben.
 */
function describeEventDe(
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  const p = payload ?? {};
  switch (kind) {
    case "page_view":
      return "Seite aufgerufen";
    case "video_play":
      return "Video gestartet";
    case "video_progress":
      return progressLabel(p);
    case "video_ended":
      return "Video komplett gesehen";
    case "video_mute":
      return "Ton stumm geschaltet";
    case "video_unmute":
      return "Ton eingeschaltet";
    case "cta_click":
      return typeof p.label === "string" && p.label
        ? `CTA „${p.label}" geklickt`
        : "CTA geklickt";
    case "cta_hover":
      return "CTA überflogen";
    case "scroll_depth": {
      const raw =
        typeof p.maxPct === "number"
          ? p.maxPct
          : typeof p.percent === "number"
            ? p.percent
            : null;
      return raw !== null ? `${Math.round(raw)} % gescrollt` : "Tief gescrollt";
    }
    case "time_on_page": {
      const sec = typeof p.seconds === "number" ? Math.round(p.seconds) : null;
      return sec !== null ? `${sec}s auf der Seite` : "Verweildauer";
    }
    case "link_click":
      return typeof p.href === "string" && p.href
        ? `Link geklickt: ${p.href}`
        : "Link geklickt";
    case "form_submit":
      return "Formular-Anfrage";
    case "letter_exported":
      return "Brief-PDF heruntergeladen";
    case "letter_sent":
      return "Brief per Post versendet";
    case "letter_status_changed":
      return "Brief-Status geändert";
    case "email_unsubscribe":
      return "Vom E-Mail-Verteiler abgemeldet";
    default:
      return "Aktivität";
  }
}
