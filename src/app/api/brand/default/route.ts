export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Account-Standard-Brand-Kit (Landingpage v3, Konzept 3.5).
 *
 * GET  → { kit: BrandKit | null }   aktuell gespeicherter Standard
 * POST → { kit }                    Standard setzen (brandKitSchema-validiert)
 *
 * Der Standard wird beim Anlegen neuer Landingpage-Vorlagen als Vorbelegung
 * genutzt (Wizard-Weg „Meinen gespeicherten Look verwenden") und kann aus
 * dem Styleguide-Panel heraus jederzeit ueberschrieben werden.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getUserById, updateUser } from "@/lib/db/queries/users";
import { brandKitSchema } from "@/lib/landing-theme/brand-kit";

const postSchema = z.object({ kit: brandKitSchema });

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const user = await getUserById(auth.user.id);
    const parsed = brandKitSchema.safeParse(user.brandKitDefault);
    return NextResponse.json({ kit: parsed.success ? parsed.data : null });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültiges Brand-Kit.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  await updateUser(auth.user.id, {
    brandKitDefault: body.kit as unknown as Record<string, unknown>,
  });
  return NextResponse.json({ kit: body.kit });
}
