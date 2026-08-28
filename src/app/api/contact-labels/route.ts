/**
 * GET  /api/contact-labels — alle Labels des Users inkl. Kontakt-Anzahl.
 * POST /api/contact-labels — Label anlegen { name, color? } (idempotent
 *      per Name, case-insensitiv).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getOrCreateContactLabel,
  listContactLabels,
} from "@/lib/db/queries/contact-labels";

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const labels = await listContactLabels(auth.user.id);
  return NextResponse.json({ labels });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: { name?: string; color?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Bitte gib einen Label-Namen ein." },
      { status: 400 },
    );
  }
  const color =
    typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : undefined;

  const label = await getOrCreateContactLabel({ userId: auth.user.id, name, color });
  return NextResponse.json({ label: { id: label.id, name: label.name, color: label.color } });
}
