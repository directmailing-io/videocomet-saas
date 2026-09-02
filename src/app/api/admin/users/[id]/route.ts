export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth-guard";
import { deleteUser, getUserById, getUserByEmail, updateUser } from "@/lib/db/queries/users";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminPassword } from "@/lib/admin-reauth";

const patchBodySchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().trim().nullable().optional(),
  lastName: z.string().trim().nullable().optional(),
  // `role` ist seit 2026-09-02 absichtlich NICHT mehr änderbar (Rollen-
  // Eskalation über eine gestohlene Admin-Session). Admin-Konten werden
  // nur noch über POST /api/admin/users mit Passwort-Bestätigung angelegt.
  phone: z.string().trim().nullable().optional(),
  companyName: z.string().trim().nullable().optional(),
  vatId: z.string().trim().nullable().optional(),
  billingStreet: z.string().trim().nullable().optional(),
  billingZip: z.string().trim().nullable().optional(),
  billingCity: z.string().trim().nullable().optional(),
  billingCountry: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const id = ctx.params.id;

  let body: z.infer<typeof patchBodySchema>;
  try {
    body = patchBodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    await getUserById(id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  if (body.email) {
    const existing = await getUserByEmail(body.email);
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "Diese E-Mail-Adresse ist bereits vergeben." }, { status: 409 });
    }
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === "email" && typeof v === "string") {
      patch.email = v.toLowerCase().trim();
    } else {
      patch[k] = v;
    }
  }

  try {
    const updated = await updateUser(id, patch);
    await logAdminAction({
      admin: { id: guard.user.id, email: guard.user.email },
      action: "user.update",
      targetType: "user",
      targetId: id,
      details: { fields: Object.keys(patch) },
      req,
    });
    return NextResponse.json({ user: stripUser(updated) });
  } catch (err) {
    console.error("[admin:users:patch] error", err);
    return NextResponse.json({ error: "Benutzer konnte nicht aktualisiert werden." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const id = ctx.params.id;
  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm");
  const expected = `DELETE-USER-${id}`;
  if (confirm !== expected) {
    return NextResponse.json(
      { error: `Confirm fehlt oder falsch. Erwartet: ?confirm=${expected}` },
      { status: 400 },
    );
  }

  if (guard.user.id === id) {
    return NextResponse.json({ error: "Du kannst dich nicht selbst löschen." }, { status: 400 });
  }

  const raw = (await req.json().catch(() => null)) as { adminPassword?: unknown } | null;
  const reauth = await requireAdminPassword(guard.user.id, raw?.adminPassword);
  if (!reauth.ok) return reauth.response;

  let targetEmail: string | null = null;
  try {
    targetEmail = (await getUserById(id)).email;
    await deleteUser(id);
  } catch (err) {
    console.error("[admin:users:delete] error", err);
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  await logAdminAction({
    admin: { id: guard.user.id, email: guard.user.email },
    action: "user.delete",
    targetType: "user",
    targetId: id,
    details: { targetEmail },
    req,
  });

  return NextResponse.json({ ok: true });
}

function stripUser<T extends { passwordHash?: string }>(u: T): Omit<T, "passwordHash"> {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}
