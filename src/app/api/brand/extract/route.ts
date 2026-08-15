export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/brand/extract — startet die Brand-Erkennung für eine
 * Website-URL (Landingpage v3, Konzept 3.1/3.2).
 *
 * Body: { url: string } — http(s)-URL der Kunden-Website.
 * Response 201: { jobId: string }
 * Response 409: bereits eine laufende Analyse für diesen User.
 *
 * Der Worker (src/worker/processors/brand-extract.ts) analysiert die
 * Seite mit Puppeteer (Farben, Schrift, Rundungen, Schatten, Logo-
 * Kandidaten) und schreibt Status + Ergebnis nach Redis unter
 * `brand-extract:<jobId>`. Das Frontend pollt GET /api/brand/extract/[jobId].
 *
 * Rate-Limit: max. 1 laufender Job pro User über den Redis-Key
 * `brand-extract:lock:<userId>` (NX + TTL; der Processor räumt ihn auf).
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { assertUrlIsSafe } from "@/lib/media-urls/ssrf-guard";
import {
  BRAND_EXTRACT_LOCK_TTL_SECONDS,
  BRAND_EXTRACT_REDIS_TTL_SECONDS,
  brandExtractQueue,
  getBrandExtractJobRedisKey,
  getBrandExtractUserLockKey,
} from "@/worker/brand-extract-queue";
import { getRedisConnection } from "@/worker/queue";

const bodySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "URL muss mit http:// oder https:// beginnen." },
    ),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // SSRF-Guard schon hier (der Worker prüft vor der Navigation nochmal) —
  // so bekommt der User sofort eine klare Antwort statt eines Job-Fails.
  try {
    await assertUrlIsSafe(body.url);
  } catch {
    return NextResponse.json(
      {
        error:
          "Diese URL können wir nicht analysieren. Bitte gib die öffentliche Adresse deiner Website an.",
      },
      { status: 400 },
    );
  }

  const jobId = randomUUID();
  const redis = getRedisConnection();
  const lockKey = getBrandExtractUserLockKey(auth.user.id);

  // Max. 1 laufender Job pro User: Lock mit NX + TTL. Value = jobId,
  // damit der Processor beim Aufräumen nur SEIN eigenes Lock löscht.
  try {
    const acquired = await redis.set(
      lockKey,
      jobId,
      "EX",
      BRAND_EXTRACT_LOCK_TTL_SECONDS,
      "NX",
    );
    if (acquired !== "OK") {
      return NextResponse.json(
        {
          error:
            "Es läuft gerade schon eine Analyse für dich. Warte kurz, bis sie fertig ist.",
        },
        { status: 409 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Die Analyse konnte nicht gestartet werden. Bitte versuche es gleich noch einmal.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }

  // Pending-Record MIT Owner VOR dem Enqueue seeden, damit das Polling
  // sofort autorisiert werden kann — auch wenn der Worker noch nicht dran ist.
  try {
    const key = getBrandExtractJobRedisKey(jobId);
    await redis.hset(key, {
      status: "pending",
      userId: auth.user.id,
      url: body.url,
    });
    await redis.expire(key, BRAND_EXTRACT_REDIS_TTL_SECONDS);
    await brandExtractQueue().add(
      "extract",
      { jobId, userId: auth.user.id, url: body.url },
      { jobId },
    );
  } catch (err) {
    await redis.del(lockKey).catch(() => undefined);
    return NextResponse.json(
      {
        error:
          "Die Analyse konnte nicht gestartet werden. Bitte versuche es gleich noch einmal.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId }, { status: 201 });
}
