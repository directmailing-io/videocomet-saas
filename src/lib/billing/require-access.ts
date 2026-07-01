/**
 * Server-side API-Guard: verhindert dass ein User ohne aktive Subscription
 * write-Operationen ausfuehrt (Runs starten, Campaigns editieren, Uploads).
 *
 * Wird zusaetzlich zum UI-Paywall genutzt — Defense-in-Depth. Ein Angreifer
 * koennte sonst per direktem API-Call rechen-intensive Operationen anstossen
 * ohne zu bezahlen.
 *
 * Umgesetzt als Middleware-Helper: die Route ruft `requireActiveAccess()`
 * am Anfang auf, bekommt entweder ok=true oder ein NextResponse-Object mit
 * HTTP 402 zurueck.
 */

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { loadAccessDecision } from "./access-gate";

export async function requireActiveAccess():
  Promise<
    | { ok: true; user: { id: string; role: "admin" | "user"; email: string } }
    | { ok: false; response: NextResponse }
  >
{
  const auth = await requireUserApi();
  if (!auth.ok) return { ok: false, response: auth.response };

  const access = await loadAccessDecision(auth.user.id);
  if (access.access === "blocked") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Zugang pausiert. Bitte Subscription aktivieren.",
          errorKind: "subscription_inactive",
          reason: access.reason,
        },
        { status: 402 },
      ),
    };
  }

  return { ok: true, user: auth.user };
}
