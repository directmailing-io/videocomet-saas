export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { scoreEmailSpam } from "@/lib/email/spam-score";
import { buildOutreachMime } from "@/lib/email/mime";
import { htmlToPlainText } from "@/lib/email/render";

const Body = z.object({
  subject: z.string().max(1_000),
  html: z.string().max(300_000),
});

/**
 * POST /api/email/spam-score — `{subject, html}` ⇒ `{score, level, hints[]}`.
 *
 * Heuristik immer; optionaler spamd-Check (SPAMD_HOST) bekommt eine
 * realistische .eml aus dem MIME-Builder, damit SpamAssassin auch
 * Struktur-Regeln (multipart, List-Unsubscribe) bewerten kann.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  let eml: string | undefined;
  if (process.env.SPAMD_HOST) {
    try {
      eml = buildOutreachMime({
        fromAddress: "check@videocomet.de",
        toAddress: "empfaenger@example.com",
        subject: parsed.data.subject,
        html: parsed.data.html,
        text: htmlToPlainText(parsed.data.html),
        messageId: `spamcheck-${Date.now()}@videocomet.de`,
        unsubscribeMailto: "check@videocomet.de",
        unsubscribeUrl: "https://app.videocomet.de/abmelden/spamcheck",
      }).raw;
    } catch {
      eml = undefined;
    }
  }

  const result = await scoreEmailSpam({
    subject: parsed.data.subject,
    html: parsed.data.html,
    eml,
  });
  return NextResponse.json(result);
}
