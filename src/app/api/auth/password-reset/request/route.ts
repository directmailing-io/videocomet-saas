export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { passwordResets } from "@/lib/db/schema";
import { getUserByEmail } from "@/lib/db/queries/users";
import { sendPasswordResetMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/tracking";

const bodySchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
});

const GENERIC_MESSAGE = "Wenn das Konto existiert, ist eine E-Mail unterwegs.";

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    // Even for invalid input, never leak info; respond uniformly.
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  // Anti-Mail-Bombing: still auslaufen lassen, Antwort bleibt generisch
  // (kein 429), damit keine Konto-Existenz ableitbar ist.
  const ip = getClientIp(req);
  const emailKey = body.email.trim().toLowerCase();
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(`pwreset:ip:${ip}`, 10, 60 * 60),
    checkRateLimit(`pwreset:email:${emailKey}`, 3, 60 * 60),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  try {
    const user = await getUserByEmail(body.email);
    if (user && user.isActive) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      try {
        await sendPasswordResetMail({
          to: user.email,
          token,
          firstName: user.firstName,
        });
      } catch (mailErr) {
        console.error("[password-reset:request] mail error", mailErr);
        // Do not surface mail failures to caller.
      }
    }
  } catch (err) {
    console.error("[password-reset:request] error", err);
    // Never surface errors that would enable user enumeration.
  }

  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
}
