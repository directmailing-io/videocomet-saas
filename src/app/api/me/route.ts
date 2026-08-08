export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAnyUserApi } from "@/lib/auth-guard";
import { getUserById, updateUser } from "@/lib/db/queries/users";

function publicUser(u: Awaited<ReturnType<typeof getUserById>>) {
  // Strip sensitive fields like passwordHash
  const { passwordHash: _hash, ...rest } = u;
  return rest;
}

export async function GET() {
  const guard = await requireAnyUserApi();
  if (!guard.ok) return guard.response;
  try {
    const user = await getUserById(guard.user.id);
    return NextResponse.json({ user: publicUser(user) });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

const ALLOWED_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "companyName",
  "vatId",
  "billingStreet",
  "billingZip",
  "billingCity",
  "billingCountry",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function sanitizeString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 255);
}

export async function PATCH(req: Request) {
  const guard = await requireAnyUserApi();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const patch: Partial<Record<AllowedField, string | null>> & {
    notifyRunEmails?: boolean;
  } = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      patch[key] = sanitizeString(body[key]);
    }
  }
  if ("notifyRunEmails" in body && typeof body.notifyRunEmails === "boolean") {
    patch.notifyRunEmails = body.notifyRunEmails;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Keine erlaubten Felder zum Aktualisieren." },
      { status: 400 },
    );
  }

  try {
    const updated = await updateUser(guard.user.id, patch);
    return NextResponse.json({ user: publicUser(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
