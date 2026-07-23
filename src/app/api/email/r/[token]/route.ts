export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailMessages, leads, userDomains } from "@/lib/db/schema";
import { insertLeadEvent } from "@/lib/db/queries/lead-events";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { getAppUrl } from "@/lib/email/render";

const FALLBACK_URL = "https://www.videocomet.de";

/**
 * GET /api/email/r/[token] — Click-Redirect aus der Outreach-Mail
 * (CTA + GIF). Token = unsubscribeToken der Message (identifiziert die
 * Message eindeutig). Ungültig ⇒ 302 auf videocomet.de.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token.trim();
  if (!/^[0-9a-f]{32}$/i.test(token)) {
    return NextResponse.redirect(FALLBACK_URL, 302);
  }

  const [row] = await db
    .select({
      leadId: emailMessages.leadId,
      slug: leads.slug,
      domainId: leads.domainId,
    })
    .from(emailMessages)
    .innerJoin(leads, eq(leads.id, emailMessages.leadId))
    .where(eq(emailMessages.unsubscribeToken, token))
    .limit(1);
  if (!row) {
    return NextResponse.redirect(FALLBACK_URL, 302);
  }

  await insertLeadEvent({ leadId: row.leadId, kind: "email_click" });

  let customHostname: string | null = null;
  if (row.domainId) {
    const [d] = await db
      .select({ hostname: userDomains.hostname })
      .from(userDomains)
      .where(eq(userDomains.id, row.domainId))
      .limit(1);
    customHostname = d?.hostname ?? null;
  }

  const pageUrl = buildLeadPublicUrl(
    { slug: row.slug, customHostname, defaultAppUrl: getAppUrl() },
    { absolute: true },
  );
  return NextResponse.redirect(pageUrl ?? FALLBACK_URL, 302);
}
