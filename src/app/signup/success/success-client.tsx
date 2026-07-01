"use client";

/**
 * Success-Page nach Stripe-Checkout.
 *
 * Kritisch: der Webhook kann Sekunden bis Minuten brauchen. Wenn User
 * sofort einloggt bevor der Webhook durchlief, sieht er die Paywall.
 * Deshalb: aktives Polling auf /api/billing/status (public-safe) bis
 * subscription aktiv ist. Bei Timeout: manuelle Fallback-Message.
 */

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Loader2, Clock } from "lucide-react";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 45_000;

type State =
  | { kind: "waiting"; elapsedSec: number }
  | { kind: "ready" }
  | { kind: "timeout" };

export function SuccessClient({ sessionId: _sessionId }: { sessionId: string | null }) {
  const [state, setState] = React.useState<State>({ kind: "waiting", elapsedSec: 0 });

  React.useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as {
            subscription: { status: string | null };
          };
          if (
            body.subscription.status === "active" ||
            body.subscription.status === "trialing"
          ) {
            if (!cancelled) setState({ kind: "ready" });
            return;
          }
        }
      } catch {
        // Not logged in yet? Weiter pollen.
      }
      const elapsed = Date.now() - start;
      if (elapsed >= POLL_TIMEOUT_MS) {
        if (!cancelled) setState({ kind: "timeout" });
        return;
      }
      if (!cancelled) {
        setState({ kind: "waiting", elapsedSec: Math.floor(elapsed / 1000) });
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-soft to-white flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-squircle-lg border border-line shadow-xl p-6 sm:p-8 text-center">
          {state.kind === "waiting" ? (
            <>
              <div className="mx-auto size-16 rounded-full bg-brand-soft flex items-center justify-center mb-4">
                <Loader2 className="size-8 text-brand animate-spin" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Fast geschafft ...</h1>
              <p className="text-sm text-ink-muted mb-4 leading-relaxed">
                Zahlung erhalten. Wir richten deinen Zugang gerade ein. Das
                dauert normalerweise ein paar Sekunden.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                <Clock className="size-3" />
                {state.elapsedSec}s
              </div>
            </>
          ) : state.kind === "ready" ? (
            <>
              <div className="mx-auto size-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="size-8 text-emerald-500" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Willkommen!</h1>
              <p className="text-sm text-ink-muted mb-6 leading-relaxed">
                Alles fertig. Dein Zugang ist aktiv, deine Rechnung ist auf dem
                Weg per Email.
              </p>
              <Link
                href="/kampagnen"
                className="inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold bg-ink text-white hover:bg-ink/90 transition-all w-full"
              >
                Zum Dashboard
                <ArrowRight className="size-4" />
              </Link>
              <p className="text-[11px] text-ink-muted mt-4">
                Nächster Schritt: Credits kaufen für deine ersten Videos.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto size-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
                <Clock className="size-8 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Braucht noch einen Moment</h1>
              <p className="text-sm text-ink-muted mb-6 leading-relaxed">
                Deine Zahlung ist eingegangen, aber die Aktivierung dauert bei
                dir länger als üblich. Log dich in ein bis zwei Minuten ein,
                dann sollte alles bereit sein. Falls nicht, schreib kurz an{" "}
                <a
                  href="mailto:info@videocomet.de"
                  className="text-brand hover:underline"
                >
                  info@videocomet.de
                </a>
                .
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold bg-ink text-white hover:bg-ink/90 transition-all w-full"
              >
                Zum Login
                <ArrowRight className="size-4" />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
