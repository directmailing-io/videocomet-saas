export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs, userDomains } from "@/lib/db/schema";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";

/**
 * GET /api/leads/[id]/open[?preview=1]
 *
 * Zentraler "Landingpage öffnen"-Redirect. Löst server-seitig die korrekte
 * öffentliche URL auf — Custom-Domain wenn der Lead mit einer generiert
 * wurde und die Domain noch aktiv ist, sonst Default `/v/<slug>`. UI-Links
 * brauchen so kein Hostname-Plumbing (der Bug war: app.videocomet.de/v/…
 * findet Custom-Domain-Leads nicht, weil der Lookup domainId-scoped ist).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({
      slug: leads.slug,
      domainHostname: userDomains.hostname,
      domainStatus: userDomains.status,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(userDomains, eq(userDomains.id, leads.domainId))
    .where(and(eq(leads.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  if (!row.slug) {
    return NextResponse.json(
      { error: "Landingpage noch nicht verfügbar." },
      { status: 404 },
    );
  }

  const customHostname =
    row.domainStatus === "active" ? row.domainHostname : null;
  const url = buildLeadPublicUrl(
    {
      slug: row.slug,
      customHostname,
      defaultAppUrl: process.env.APP_URL,
    },
    {
      preview: req.nextUrl.searchParams.get("preview") === "1",
      absolute: true,
    },
  );
  if (!url) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.redirect(url, { status: 302 });
}
