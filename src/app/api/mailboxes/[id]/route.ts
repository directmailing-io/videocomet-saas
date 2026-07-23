export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 *  GET    /api/mailboxes/:id  → Detail
 *  PATCH  /api/mailboxes/:id  → sendWindow / timezone / status / dailyCap
 *  DELETE /api/mailboxes/:id  → nur wenn kein laufender Blast das Postfach nutzt
 *
 * Schutzpaket: dailyCap hart ≤ 50, Sendefenster/Zeitzone sind die einzigen
 * frei einstellbaren Versand-Parameter.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import type { MailboxSendWindow, MailboxStatus } from "@/lib/db/schema";
import {
  deleteMailboxConnection,
  getMailboxConnection,
  hasActiveBlast,
  serializeMailbox,
  updateMailboxConnection,
  type MailboxSettingsPatch,
} from "@/lib/db/queries/mailboxes";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const mailbox = await getMailboxConnection(id, auth.user.id);
  if (!mailbox) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ mailbox: serializeMailbox(mailbox) });
}

function parseSendWindow(input: unknown):
  | { ok: true; value: MailboxSendWindow }
  | { ok: false; error: string } {
  const raw = input as Partial<MailboxSendWindow> | null;
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "sendWindow muss ein Objekt sein." };
  }
  const days = Array.isArray(raw.days)
    ? Array.from(new Set(raw.days.map((d) => Number(d)))).sort((a, b) => a - b)
    : null;
  if (!days || days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return {
      ok: false,
      error: "Bitte mindestens einen Wochentag auswählen (1 = Montag … 7 = Sonntag).",
    };
  }
  const startHour = Number(raw.startHour);
  const endHour = Number(raw.endHour);
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    startHour > 23 ||
    endHour < 1 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    return {
      ok: false,
      error: "Das Sendefenster ist ungültig — die Start-Stunde muss vor der End-Stunde liegen.",
    };
  }
  return { ok: true, value: { days, startHour, endHour } };
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface PatchBody {
  sendWindow?: unknown;
  timezone?: unknown;
  status?: unknown;
  dailyCap?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const mailbox = await getMailboxConnection(id, auth.user.id);
  if (!mailbox) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body muss JSON sein." }, { status: 400 });
  }

  const patch: MailboxSettingsPatch = {};

  if (body.sendWindow !== undefined) {
    const parsed = parseSendWindow(body.sendWindow);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.sendWindow = parsed.value;
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      return NextResponse.json(
        { error: "Unbekannte Zeitzone. Beispiel: Europe/Berlin." },
        { status: 400 },
      );
    }
    patch.timezone = body.timezone;
  }

  if (body.dailyCap !== undefined) {
    const cap = Number(body.dailyCap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 50) {
      return NextResponse.json(
        { error: "Das Tageslimit muss zwischen 1 und 50 liegen (Hard-Max 50)." },
        { status: 400 },
      );
    }
    patch.dailyCap = cap;
  }

  if (body.status !== undefined) {
    const status = body.status as MailboxStatus;
    if (status !== "disabled" && status !== "connected") {
      return NextResponse.json(
        { error: "Status kann nur auf 'disabled' oder 'connected' gesetzt werden." },
        { status: 400 },
      );
    }
    if (status === "connected" && mailbox.status === "token_expired") {
      return NextResponse.json(
        {
          error:
            "Die Anmeldung ist abgelaufen. Bitte verbinden Sie das Postfach neu (Microsoft-Login bzw. Verbindungstest).",
        },
        { status: 409 },
      );
    }
    patch.status = status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Keine änderbaren Felder im Body (sendWindow, timezone, status, dailyCap)." },
      { status: 400 },
    );
  }

  const updated = await updateMailboxConnection(id, auth.user.id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ mailbox: serializeMailbox(updated) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const mailbox = await getMailboxConnection(id, auth.user.id);
  if (!mailbox) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  if (await hasActiveBlast(mailbox.id)) {
    return NextResponse.json(
      {
        error:
          "Dieses Postfach wird von einem laufenden E-Mail-Versand genutzt. Bitte brechen Sie den Versand zuerst ab oder warten Sie, bis er abgeschlossen ist.",
      },
      { status: 409 },
    );
  }

  await deleteMailboxConnection(id, auth.user.id);
  return NextResponse.json({ ok: true });
}
