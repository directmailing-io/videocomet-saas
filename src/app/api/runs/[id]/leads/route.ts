export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { analyticsEvents, leads, runs } from "@/lib/db/schema";

type ListStatus = "all" | "opened" | "started" | "completed" | "failed";
type SortKey = "name" | "status" | "openedAt";

function parseStatus(v: string | null): ListStatus {
  switch (v) {
    case "opened":
    case "started":
    case "completed":
    case "failed":
      return v;
    default:
      return "all";
  }
}

function parseSort(v: string | null): SortKey {
  switch (v) {
    case "status":
    case "openedAt":
      return v;
    default:
      return "name";
  }
}

function parseInt32(v: string | null, fallback: number, min: number, max: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const sort = parseSort(url.searchParams.get("sort"));
  const page = parseInt32(url.searchParams.get("page"), 0, 0, 10_000);
  const limit = parseInt32(url.searchParams.get("limit"), 50, 1, 200);
  const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const offset = page * limit;

  // Tenant-Guard: ensure the run belongs to the caller.
  const [runRow] = await db
    .select({ id: runs.id, name: runs.name })
    .from(runs)
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);
  if (!runRow) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Per-lead aggregates over analyticsEvents. We compute these for every lead
  // and then filter/paginate in JS, which is fine for the small per-run scale
  // here (max ~1500 leads per run as per SPEC).
  const baseRows = await db
    .select({
      id: leads.id,
      slug: leads.slug,
      data: leads.data,
      status: leads.status,
      videoUrl: leads.videoUrl,
      pdfUrl: leads.pdfUrl,
      thumbnailUrl: leads.thumbnailUrl,
      bunnyVideoId: leads.bunnyVideoId,
      rowIndex: leads.rowIndex,
      createdAt: leads.createdAt,
      opens: sql<number>`count(case when ${analyticsEvents.eventType} = 'page_view' then 1 end)::int`,
      firstOpenAt: sql<Date | null>`min(case when ${analyticsEvents.eventType} = 'page_view' then ${analyticsEvents.createdAt} end)`,
      lastOpenAt: sql<Date | null>`max(case when ${analyticsEvents.eventType} = 'page_view' then ${analyticsEvents.createdAt} end)`,
      videoStarted: sql<boolean>`bool_or(${analyticsEvents.eventType} = 'video_start')`,
      watchedPercent: sql<number | null>`max(case when ${analyticsEvents.eventType} = 'video_progress' then (${analyticsEvents.eventData} ->> 'progress')::float end)`,
      ctaClicked: sql<number>`count(case when ${analyticsEvents.eventType} = 'cta_click' then 1 end)::int`,
      lastEventAt: sql<Date | null>`max(${analyticsEvents.createdAt})`,
    })
    .from(leads)
    .leftJoin(analyticsEvents, eq(analyticsEvents.leadId, leads.id))
    .where(eq(leads.runId, params.id))
    .groupBy(leads.id);

  type Row = (typeof baseRows)[number];

  // Extract first/last name + email from the JSON `data` blob. Mapping is
  // tolerant of common column names so the table renders even if the user
  // mapped slightly different headers.
  function pickField(data: Record<string, string> | null, keys: string[]): string | null {
    if (!data) return null;
    for (const k of Object.keys(data)) {
      if (keys.some((needle) => k.toLowerCase() === needle)) {
        const v = data[k];
        if (v && String(v).trim()) return String(v).trim();
      }
    }
    return null;
  }

  function toShape(r: Row) {
    const data = r.data ?? null;
    const firstName = pickField(data, ["vorname", "firstname", "first_name", "first name"]);
    const lastName = pickField(data, ["nachname", "lastname", "last_name", "last name"]);
    const email = pickField(data, ["email", "e-mail", "mail"]);
    const slug = r.slug;
    const pageUrl = slug ? `/v/${slug}` : null;
    return {
      id: r.id,
      slug,
      firstName,
      lastName,
      email,
      status: r.status,
      opens: r.opens ?? 0,
      firstOpenAt: r.firstOpenAt,
      lastOpenAt: r.lastOpenAt,
      videoStarted: Boolean(r.videoStarted),
      watchedPercent: r.watchedPercent == null ? 0 : Number(r.watchedPercent),
      ctaClicked: r.ctaClicked ?? 0,
      videoUrl: r.videoUrl,
      pageUrl,
      pdfUrl: r.pdfUrl,
      lastEventAt: r.lastEventAt,
      rowIndex: r.rowIndex,
    };
  }

  let shaped = baseRows.map(toShape);

  // Status filter: the "status" tabs combine lead-table status with derived
  // engagement state from analyticsEvents.
  if (status === "opened") {
    shaped = shaped.filter((r) => r.opens > 0);
  } else if (status === "started") {
    shaped = shaped.filter((r) => r.videoStarted);
  } else if (status === "completed") {
    shaped = shaped.filter((r) => r.status === "completed");
  } else if (status === "failed") {
    shaped = shaped.filter((r) => r.status === "failed");
  }

  // Free-text search across name + email.
  if (search) {
    shaped = shaped.filter((r) => {
      const hay = [r.firstName, r.lastName, r.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(search);
    });
  }

  // Sort.
  shaped.sort((a, b) => {
    if (sort === "status") {
      return a.status.localeCompare(b.status);
    }
    if (sort === "openedAt") {
      const at = a.lastOpenAt ? new Date(a.lastOpenAt).getTime() : 0;
      const bt = b.lastOpenAt ? new Date(b.lastOpenAt).getTime() : 0;
      return bt - at; // most-recently-opened first
    }
    // name (default): firstName then lastName, falling back to rowIndex.
    const an = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim().toLowerCase();
    const bn = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim().toLowerCase();
    if (an && bn) return an.localeCompare(bn);
    if (an) return -1;
    if (bn) return 1;
    return (a.rowIndex ?? 0) - (b.rowIndex ?? 0);
  });

  const total = shaped.length;
  const items = shaped.slice(offset, offset + limit);

  return NextResponse.json({
    items,
    page,
    limit,
    total,
    hasMore: offset + items.length < total,
  });
}

