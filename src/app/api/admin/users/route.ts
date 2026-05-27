import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth-guard";
import { createUser, getUserByEmail, listUsers } from "@/lib/db/queries/users";
import { sendAdminInviteMail } from "@/lib/mail";

const listQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["admin", "user"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  let q: z.infer<typeof listQuerySchema>;
  try {
    q = listQuerySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const offset = (q.page - 1) * q.limit;
  const { items, total } = await listUsers({
    search: q.search,
    role: q.role,
    limit: q.limit,
    offset,
  });

  const users = items.map(stripUser);
  const hasMore = offset + users.length < total;

  return NextResponse.json({ users, total, hasMore, page: q.page, limit: q.limit });
}

const createBodySchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "user"]).default("user"),
  phone: z.string().trim().optional(),
  companyName: z.string().trim().optional(),
  vatId: z.string().trim().optional(),
  billingStreet: z.string().trim().optional(),
  billingZip: z.string().trim().optional(),
  billingCity: z.string().trim().optional(),
  billingCountry: z.string().trim().optional(),
  password: z.string().min(8).optional(),
  sendInviteMail: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof createBodySchema>;
  try {
    body = createBodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const existing = await getUserByEmail(body.email);
  if (existing) {
    return NextResponse.json({ error: "Diese E-Mail-Adresse ist bereits vergeben." }, { status: 409 });
  }

  const tempPassword = body.password ?? generateTempPassword();

  let user;
  try {
    user = await createUser({
      email: body.email,
      password: tempPassword,
      role: body.role,
      isActive: true,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      phone: body.phone ?? null,
      companyName: body.companyName ?? null,
      vatId: body.vatId ?? null,
      billingStreet: body.billingStreet ?? null,
      billingZip: body.billingZip ?? null,
      billingCity: body.billingCity ?? null,
      billingCountry: body.billingCountry ?? "DE",
    });
  } catch (err) {
    console.error("[admin:users:create] error", err);
    return NextResponse.json({ error: "Benutzer konnte nicht angelegt werden." }, { status: 500 });
  }

  if (body.sendInviteMail) {
    try {
      await sendAdminInviteMail({
        to: user.email,
        firstName: user.firstName,
        tempPassword,
      });
    } catch (mailErr) {
      console.error("[admin:users:create] invite mail error", mailErr);
    }
  }

  return NextResponse.json(
    {
      user: stripUser(user),
      tempPassword: body.password ? undefined : tempPassword,
    },
    { status: 201 },
  );
}

function generateTempPassword(): string {
  // ~20 chars, url-safe alphabet, lots of entropy
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

function stripUser<T extends { passwordHash?: string }>(u: T): Omit<T, "passwordHash"> {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}
